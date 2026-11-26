import { randomBytes, randomUUID } from "node:crypto";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.argv.includes("--confirm-disposable-project")) {
  console.error("Refusing to run without --confirm-disposable-project.");
  process.exit(2);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appOrigin = process.env.FLOCKLEDGER_P1A2_APP_ORIGIN ?? "http://localhost:3101";

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  console.error("Missing required Supabase environment variables.");
  process.exit(2);
}

if (!new URL(supabaseUrl).hostname.endsWith(".supabase.co")) {
  console.error("Refusing to run against a non-hosted Supabase URL.");
  process.exit(2);
}

const createdUserIds = [];
const ownerUserIds = new Set();
const farmIds = [];
const assertions = [];
let cleanupFailed = false;
let cleanupRequiresProjectRetirement = false;

function logRequest(label, method, path, status) {
  console.log(JSON.stringify({ type: "request", label, method, path, status }));
}

function check(label, passed, detail = "") {
  assertions.push({ label, passed });
  console.log(JSON.stringify({
    type: "assertion",
    label,
    result: passed ? "PASS" : "FAIL",
    ...(detail ? { detail } : {}),
  }));
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function queryString(entries) {
  return new URLSearchParams(entries).toString();
}

async function requestApi(label, actor, method, path, body, extraHeaders = {}) {
  const headers = {
    Origin: appOrigin,
    "Sec-Fetch-Site": "same-origin",
    ...extraHeaders,
  };
  if (actor?.cookies?.size) {
    headers.Cookie = [...actor.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(new URL(path, appOrigin), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (actor?.cookies) {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) actor.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  const payload = parseJson(await response.text());
  logRequest(label, method, path, response.status);
  return { status: response.status, payload };
}

async function requestRest(label, method, resource, query = "", body, accessToken) {
  const url = new URL(`/rest/v1/${resource}`, supabaseUrl);
  if (query) url.search = query;
  const headers = {
    apikey: accessToken ? anonKey : serviceRoleKey,
    Authorization: `Bearer ${accessToken ?? serviceRoleKey}`,
    Accept: "application/json",
    Prefer: "return=representation",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = parseJson(await response.text());
  logRequest(label, method, `/rest/v1/${resource}${query ? `?${query}` : ""}`, response.status);
  return { status: response.status, payload };
}

async function requestAuth(label, method, path, body) {
  const response = await fetch(new URL(path, supabaseUrl), {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = parseJson(await response.text());
  logRequest(label, method, path, response.status);
  return { status: response.status, payload };
}

async function createTestUser(label) {
  const email = `phase1a2-${label}-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const response = await requestAuth("create-synthetic-auth-user", "POST", "/auth/v1/admin/users", {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Phase 1A.2 ${label}` },
  });
  if (response.status < 200 || response.status >= 300 || !response.payload?.id) {
    throw new Error(`Synthetic Auth user creation failed (${response.status}).`);
  }
  createdUserIds.push(response.payload.id);
  return { id: response.payload.id, email, password };
}

async function signIn(email, password, label) {
  const authResponse = await fetch(
    new URL("/auth/v1/token?grant_type=password", supabaseUrl),
    {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const authPayload = parseJson(await authResponse.text());
  logRequest(`${label}-real-auth-session`, "POST", "/auth/v1/token?grant_type=password", authResponse.status);
  if (!authResponse.ok || !authPayload?.access_token || !authPayload?.user?.id) {
    throw new Error(`${label}: real Supabase Auth sign-in failed (${authResponse.status}).`);
  }

  const actor = { id: authPayload.user.id, accessToken: authPayload.access_token, cookies: new Map() };
  const appResponse = await requestApi(`${label}-application-sign-in`, actor, "POST", "/api/auth/sign-in", {
    email,
    password,
  });
  if (appResponse.status !== 200 || actor.cookies.size === 0) {
    throw new Error(`${label}: application cookie session failed (${appResponse.status}).`);
  }
  return actor;
}

async function createFarm(actor, label) {
  const response = await requestApi(`${label}-create-farm`, actor, "POST", "/api/farms", {
    name: `Phase 1A.2 ${label} ${randomUUID().slice(0, 8)}`,
    openingCashBalanceKes: 0,
  });
  if (response.status !== 201 || !response.payload?.data?.id) {
    throw new Error(`${label}: farm fixture setup failed (${response.status}).`);
  }
  farmIds.push(response.payload.data.id);
  return response.payload.data.id;
}

async function createBatch(actor, farmId, label) {
  const batchCode = `BAT-${randomBytes(4).toString("hex").toUpperCase()}`;
  const response = await requestApi(`${label}-create-batch`, actor, "POST", "/api/batches", {
    farmId,
    batchCode,
    batchType: "Broiler",
    datePlaced: new Date().toISOString().slice(0, 10),
    chicksOrdered: 10,
    chicksReceived: 10,
  });
  if (response.status !== 201 || !response.payload?.data?.id) {
    throw new Error(`${label}: batch fixture setup failed (${response.status}).`);
  }
  return { id: response.payload.data.id, batchCode };
}

async function adminRows(table, filters, fields = "id") {
  const query = queryString({ select: fields, ...filters });
  const response = await requestRest(`verify-database-${table}`, "GET", table, query);
  if (response.status !== 200 || !Array.isArray(response.payload)) {
    throw new Error(`Database verification query failed (${response.status}).`);
  }
  return response.payload;
}

async function verifyRow(label, table, filters, expected) {
  const rows = await adminRows(table, filters, "*");
  const passed = rows.length > 0 && expected(rows[0]);
  check(label, passed, passed ? "expected row state verified" : `rows=${rows.length}`);
  return rows[0] ?? null;
}

async function cleanup() {
  const farmScopedTables = [
    "cash_entries",
    "sale_payments",
    "sales",
    "corrections",
    "daily_records",
    "weight_records",
    "feed_deliveries",
    "health_records",
    "stock_movements",
    "maintenance_records",
    "brooding_observations",
    "biosecurity_visits",
    "house_activity_records",
    "labour_records",
    "utility_usage",
    "compliance_records",
    "assets",
    "inventory_items",
    "farm_invitations",
    "farm_staff_seat_reservations",
    "subscription_payments",
    "subscription_invoices",
    "subscription_usage",
    "batches",
  ];

  for (const farmId of farmIds) {
    for (const table of farmScopedTables) {
      const response = await requestRest(
        `cleanup-synthetic-${table}`,
        "DELETE",
        table,
        queryString({ farm_id: `eq.${farmId}` }),
      );
      if (response.status < 200 || response.status >= 300) {
        cleanupFailed = true;
        console.error(JSON.stringify({
          type: "cleanup",
          resource: table,
          result: "FAIL",
          status: response.status,
          code: response.payload?.code ?? null,
        }));
      }
    }
    const membershipResponse = await requestRest(
      "cleanup-synthetic-staff-memberships",
      "DELETE",
      "farm_memberships",
      queryString({ farm_id: `eq.${farmId}`, role: "neq.owner" }),
    );
    if (membershipResponse.status < 200 || membershipResponse.status >= 300) {
      cleanupFailed = true;
      console.error(JSON.stringify({
        type: "cleanup",
        resource: "staff-memberships",
        result: "FAIL",
        status: membershipResponse.status,
        code: membershipResponse.payload?.code ?? null,
      }));
    }
  }

  for (const userId of createdUserIds) {
    if (ownerUserIds.has(userId)) continue;
    const response = await requestAuth(
      "cleanup-synthetic-auth-user",
      "DELETE",
      `/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    );
    if (response.status < 200 || response.status >= 300) {
      cleanupFailed = true;
      console.error(JSON.stringify({ type: "cleanup", resource: "auth-user", result: "FAIL", status: response.status }));
    } else {
      console.log(JSON.stringify({ type: "cleanup", resource: "auth-user", result: "PASS", status: response.status }));
    }
  }
  cleanupRequiresProjectRetirement = farmIds.length > 0;
  if (cleanupRequiresProjectRetirement) {
    console.log(JSON.stringify({
      type: "cleanup",
      resource: "synthetic-farms-and-append-only-events",
      result: "RETAINED",
      reason: "subscription_events are append-only and restrict farm deletion",
    }));
  }
}

async function main() {
  const anonymous = await requestApi("unauthenticated-protected-api", null, "GET", "/api/farms");
  check("Unauthenticated application access is rejected", anonymous.status === 401);

  const ownerAUser = await createTestUser("owner-a");
  const ownerBUser = await createTestUser("owner-b");
  ownerUserIds.add(ownerAUser.id);
  ownerUserIds.add(ownerBUser.id);
  const ownerA = await signIn(ownerAUser.email, ownerAUser.password, "owner-a");
  const ownerB = await signIn(ownerBUser.email, ownerBUser.password, "owner-b");
  const farmA = await createFarm(ownerA, "farm-a");
  const farmB = await createFarm(ownerB, "farm-b");

  const staff = {};
  for (const role of ["manager", "accountant", "attendant", "veterinarian"]) {
    const user = await createTestUser(role);
    const response = await requestRest(
      `fixture-membership-${role}`,
      "POST",
      "farm_memberships",
      "",
      { farm_id: farmA, user_id: user.id, role },
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${role}: fixture membership setup failed (${response.status}).`);
    }
    staff[role] = await signIn(user.email, user.password, role);
  }

  const batchA = await createBatch(staff.manager, farmA, "manager-farm-a");
  const batchB = await createBatch(ownerB, farmB, "owner-b-farm-b");
  const date = new Date().toISOString().slice(0, 10);
  const dailyFixture = await requestApi("owner-b-create-daily-fixture", ownerB, "POST", "/api/daily-records", {
    farmId: farmB,
    batchId: batchB.id,
    recordDate: date,
    dead: 0,
    culled: 0,
    feedGivenKg: 1,
    feedLeftKg: 0,
    waterLiters: 1,
    remarks: "phase1a2-fixture-original",
  });
  if (dailyFixture.status !== 201 || !dailyFixture.payload?.data?.id) {
    throw new Error(`Farm B daily-record fixture setup failed (${dailyFixture.status}).`);
  }
  const dailyBId = dailyFixture.payload.data.id;

  check(
    "Farm B batch fixture exists",
    (await adminRows("batches", { id: `eq.${batchB.id}`, farm_id: `eq.${farmB}` })).length === 1,
  );
  check(
    "Farm B daily-record fixture exists",
    (await adminRows("daily_records", { id: `eq.${dailyBId}`, farm_id: `eq.${farmB}` })).length === 1,
  );

  const directRead = await requestRest(
    "owner-a-postgrest-read-farm-b",
    "GET",
    "batches",
    queryString({ select: "id,farm_id", id: `eq.${batchB.id}` }),
    undefined,
    ownerA.accessToken,
  );
  check(
    "Owner A cannot read Farm B batch through PostgREST",
    directRead.status === 200 && Array.isArray(directRead.payload) && directRead.payload.length === 0,
  );

  const appRead = await requestApi("owner-a-api-read-farm-b", ownerA, "GET", `/api/batches?farmId=${farmB}`);
  check(
    "Owner A cannot read Farm B batch through application API",
    appRead.status === 200 &&
      Array.isArray(appRead.payload?.data) &&
      !appRead.payload.data.some((row) => row.id === batchB.id),
  );
  const appDailyRead = await requestApi(
    "owner-a-api-read-farm-b-daily-record",
    ownerA,
    "GET",
    `/api/daily-records?farmId=${farmB}&batchId=${batchB.id}`,
  );
  check(
    "Owner A cannot read Farm B daily record through application API",
    appDailyRead.status === 200 &&
      Array.isArray(appDailyRead.payload?.data) &&
      !appDailyRead.payload.data.some((row) => row.id === dailyBId),
  );

  const directBatchInsertCode = `BAT-${randomBytes(4).toString("hex").toUpperCase()}`;
  const directBatchInsert = await requestRest(
    "owner-a-postgrest-insert-farm-b-batch",
    "POST",
    "batches",
    "",
    {
      farm_id: farmB,
      batch_code: directBatchInsertCode,
      batch_type: "Broiler",
      date_placed: date,
      chicks_ordered: 10,
      chicks_received: 10,
      created_by: ownerA.id,
    },
    ownerA.accessToken,
  );
  check("Owner A direct INSERT into Farm B is rejected", directBatchInsert.status < 200 || directBatchInsert.status >= 300);
  check(
    "Rejected direct INSERT left no Farm B batch",
    (await adminRows("batches", { batch_code: `eq.${directBatchInsertCode}` })).length === 0,
  );

  const directDailyInsert = await requestRest(
    "owner-a-postgrest-insert-farm-a-record-on-farm-b-batch",
    "POST",
    "daily_records",
    "",
    {
      farm_id: farmA,
      batch_id: batchB.id,
      record_date: date,
      dead: 0,
      culled: 0,
      feed_given_kg: 1,
      feed_left_kg: 0,
      water_liters: 1,
      created_by: ownerA.id,
    },
    ownerA.accessToken,
  );
  check("Farm A cannot insert a record referencing Farm B batch", directDailyInsert.status < 200 || directDailyInsert.status >= 300);
  check(
    "Rejected cross-farm INSERT left no Farm A record on Farm B batch",
    (await adminRows("daily_records", {
      farm_id: `eq.${farmA}`,
      batch_id: `eq.${batchB.id}`,
      record_date: `eq.${date}`,
    })).length === 0,
  );

  const appBatchCode = `BAT-${randomBytes(4).toString("hex").toUpperCase()}`;
  const appBatchInsert = await requestApi("owner-a-api-insert-farm-b-batch", ownerA, "POST", "/api/batches", {
    farmId: farmB,
    batchCode: appBatchCode,
    batchType: "Broiler",
    datePlaced: date,
    chicksOrdered: 10,
    chicksReceived: 10,
  });
  check("Owner A application INSERT into Farm B is denied", [403, 409].includes(appBatchInsert.status));
  check(
    "Rejected application INSERT left no Farm B batch",
    (await adminRows("batches", { batch_code: `eq.${appBatchCode}` })).length === 0,
  );

  for (const targetFarmId of [farmA, farmB]) {
    const label = targetFarmId === farmA ? "authorized-farm-id" : "target-farm-id";
    const update = await requestRest(
      `owner-a-postgrest-update-${label}`,
      "PATCH",
      "daily_records",
      queryString({ id: `eq.${dailyBId}`, farm_id: `eq.${targetFarmId}`, select: "id" }),
      { remarks: "phase1a2-unauthorized-update" },
      ownerA.accessToken,
    );
    check(
      `Owner A PostgREST UPDATE using ${label} changes no rows`,
      update.status >= 200 && update.status < 300 && Array.isArray(update.payload) && update.payload.length === 0,
    );

    const remove = await requestRest(
      `owner-a-postgrest-delete-${label}`,
      "DELETE",
      "daily_records",
      queryString({ id: `eq.${dailyBId}`, farm_id: `eq.${targetFarmId}`, select: "id" }),
      undefined,
      ownerA.accessToken,
    );
    check(
      `Owner A PostgREST DELETE using ${label} changes no rows`,
      remove.status >= 200 && remove.status < 300 && Array.isArray(remove.payload) && remove.payload.length === 0,
    );
    await verifyRow(
      "Farm B daily record remains unchanged after PostgREST mutation attempts",
      "daily_records",
      { id: `eq.${dailyBId}` },
      (row) => row.remarks === "phase1a2-fixture-original",
    );
  }

  for (const targetFarmId of [farmA, farmB]) {
    const label = targetFarmId === farmA ? "farm-a-id" : "farm-b-id";
    const patch = await requestApi(
      `owner-a-api-update-${label}`,
      ownerA,
      "PATCH",
      `/api/records/daily-records/${dailyBId}`,
      { farmId: targetFarmId, changes: { remarks: "phase1a2-unauthorized-update" } },
    );
    check(`Owner A application UPDATE using ${label} is denied`, [403, 404].includes(patch.status));
    const remove = await requestApi(
      `owner-a-api-delete-${label}`,
      ownerA,
      "DELETE",
      `/api/records/daily-records/${dailyBId}?farmId=${targetFarmId}`,
    );
    check(`Owner A application DELETE using ${label} is denied`, [403, 404].includes(remove.status));
  }
  await verifyRow(
    "Farm B daily record remains unchanged after application mutation attempts",
    "daily_records",
    { id: `eq.${dailyBId}` },
    (row) => row.remarks === "phase1a2-fixture-original",
  );

  const close = await requestApi(
    "owner-a-api-close-farm-b-batch",
    ownerA,
    "POST",
    `/api/batches/${batchB.id}/close`,
    { farmId: farmB, dateSoldOut: date },
  );
  check("Owner A cannot close Farm B batch through API", [403, 404].includes(close.status));
  await verifyRow("Farm B batch remains running", "batches", { id: `eq.${batchB.id}` }, (row) => row.status === "running");

  const rpcCode = `BAT-${randomBytes(4).toString("hex").toUpperCase()}`;
  const rpc = await requestRest(
    "owner-a-direct-cross-farm-quota-rpc",
    "POST",
    "rpc/create_batch_with_quota",
    "",
    {
      p_farm_id: farmB,
      p_batch_code: rpcCode,
      p_batch_type: "Broiler",
      p_rearing_system: null,
      p_house: null,
      p_date_placed: date,
      p_source: null,
      p_strain: null,
      p_chicks_ordered: 10,
      p_chicks_received: 10,
      p_remarks: null,
    },
    ownerA.accessToken,
  );
  check("Owner A direct cross-farm quota RPC is rejected", rpc.status < 200 || rpc.status >= 300);
  check("Rejected cross-farm RPC created no batch", (await adminRows("batches", { batch_code: `eq.${rpcCode}` })).length === 0);

  const managerInvitation = await requestApi(
    "manager-post-staff-invitation",
    staff.manager,
    "POST",
    `/api/farms/${farmA}/invitations`,
    {
      email: `phase1a2-denied-${randomUUID()}@example.invalid`,
      role: "attendant",
      password: randomBytes(24).toString("base64url"),
    },
    { "Idempotency-Key": randomUUID() },
  );
  check("Manager cannot create staff invitation", managerInvitation.status === 403);

  const ownerCrossFarmInvitation = await requestApi(
    "owner-a-post-invitation-for-farm-b",
    ownerA,
    "POST",
    `/api/farms/${farmB}/invitations`,
    {
      email: `phase1a2-cross-${randomUUID()}@example.invalid`,
      role: "attendant",
      password: randomBytes(24).toString("base64url"),
    },
    { "Idempotency-Key": randomUUID() },
  );
  check("Owner A cannot create invitation for Farm B", ownerCrossFarmInvitation.status === 403);

  const selfPromotion = await requestApi(
    "manager-self-promotion",
    staff.manager,
    "PATCH",
    `/api/farms/${farmA}/members`,
    { userId: staff.manager.id, role: "owner" },
  );
  check("Manager cannot promote self to owner", selfPromotion.status === 403);
  const managerRows = await adminRows("farm_memberships", {
    farm_id: `eq.${farmA}`,
    user_id: `eq.${staff.manager.id}`,
  }, "role");
  check("Manager self-promotion did not change database role", managerRows[0]?.role === "manager");

  const accountantSaleCode = `P1A2-${randomBytes(6).toString("hex").toUpperCase()}`;
  const sale = await requestApi(
    "accountant-create-sale",
    staff.accountant,
    "POST",
    "/api/sales",
    {
      farmId: farmA,
      batchId: batchA.id,
      saleDate: date,
      customer: "Phase 1A.2 customer",
      birdsSold: 1,
      totalWeightKg: 1,
      priceBasis: "Bird",
      priceKes: 10,
      paidKes: 0,
      receiptNumber: accountantSaleCode,
    },
    { "Idempotency-Key": randomUUID() },
  );
  check("Accountant can create Farm A sale", sale.status === 201);
  check(
    "Accountant sale is persisted in Farm A",
    (await adminRows("sales", { farm_id: `eq.${farmA}`, receipt_number: `eq.${accountantSaleCode}` })).length === 1,
  );

  const cashDetails = `Phase1A2-${randomBytes(6).toString("hex")}`;
  const cash = await requestApi(
    "accountant-create-cash-entry",
    staff.accountant,
    "POST",
    "/api/cash-entries",
    {
      farmId: farmA,
      batchId: batchA.id,
      entryDate: date,
      details: cashDetails,
      category: "expense",
      moneyInKes: 0,
      moneyOutKes: 1,
    },
    { "Idempotency-Key": randomUUID() },
  );
  check("Accountant can create Farm A cash entry", cash.status === 201);
  check(
    "Accountant cash entry is persisted in Farm A",
    (await adminRows("cash_entries", { farm_id: `eq.${farmA}`, details: `eq.${cashDetails}` })).length === 1,
  );

  const accountantDailyDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const accountantDaily = await requestApi(
    "accountant-create-daily-record",
    staff.accountant,
    "POST",
    "/api/daily-records",
    {
      farmId: farmA,
      batchId: batchA.id,
      recordDate: accountantDailyDate,
      dead: 0,
      culled: 0,
      feedGivenKg: 1,
      feedLeftKg: 0,
      waterLiters: 1,
    },
  );
  check("Accountant cannot create daily record", [403, 409].includes(accountantDaily.status));
  check(
    "Denied accountant daily record was not persisted",
    (await adminRows("daily_records", {
      farm_id: `eq.${farmA}`,
      batch_id: `eq.${batchA.id}`,
      record_date: `eq.${accountantDailyDate}`,
    })).length === 0,
  );

  const attendantDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const attendantDaily = await requestApi(
    "attendant-create-daily-record",
    staff.attendant,
    "POST",
    "/api/daily-records",
    {
      farmId: farmA,
      batchId: batchA.id,
      recordDate: attendantDate,
      dead: 0,
      culled: 0,
      feedGivenKg: 1,
      feedLeftKg: 0,
      waterLiters: 1,
    },
  );
  check("Attendant can create Farm A daily record", attendantDaily.status === 201);
  check(
    "Attendant daily record is persisted in Farm A",
    (await adminRows("daily_records", {
      farm_id: `eq.${farmA}`,
      batch_id: `eq.${batchA.id}`,
      record_date: `eq.${attendantDate}`,
    })).length === 1,
  );

  const attendantHealth = await requestApi(
    "attendant-create-health-record",
    staff.attendant,
    "POST",
    "/api/health-records",
    { farmId: farmA, batchId: batchA.id, recordDate: date, recordType: "Vaccination" },
  );
  check("Attendant cannot create health record", attendantHealth.status === 403);
  check(
    "Denied attendant health record was not persisted",
    (await adminRows("health_records", {
      farm_id: `eq.${farmA}`,
      batch_id: `eq.${batchA.id}`,
      record_date: `eq.${date}`,
    })).length === 0,
  );

  const veterinarianHealth = await requestApi(
    "veterinarian-create-health-record",
    staff.veterinarian,
    "POST",
    "/api/health-records",
    { farmId: farmA, batchId: batchA.id, recordDate: date, recordType: "Vaccination" },
  );
  check("Veterinarian can create Farm A health record", veterinarianHealth.status === 201);
  check(
    "Veterinarian health record is persisted in Farm A",
    (await adminRows("health_records", {
      farm_id: `eq.${farmA}`,
      batch_id: `eq.${batchA.id}`,
      record_date: `eq.${date}`,
    })).length === 1,
  );

  const vetCashDetails = `Unauthorized-${randomBytes(6).toString("hex")}`;
  const veterinarianCash = await requestApi(
    "veterinarian-create-cash-entry",
    staff.veterinarian,
    "POST",
    "/api/cash-entries",
    {
      farmId: farmA,
      batchId: batchA.id,
      entryDate: date,
      details: vetCashDetails,
      category: "expense",
      moneyInKes: 0,
      moneyOutKes: 1,
    },
    { "Idempotency-Key": randomUUID() },
  );
  check("Veterinarian cannot create cash entry", [403, 409].includes(veterinarianCash.status));
  check(
    "Denied veterinarian cash entry was not persisted",
    (await adminRows("cash_entries", { farm_id: `eq.${farmA}`, details: `eq.${vetCashDetails}` })).length === 0,
  );

  const roleChange = await requestApi(
    "owner-change-member-role",
    ownerA,
    "PATCH",
    `/api/farms/${farmA}/members`,
    { userId: staff.accountant.id, role: "manager" },
  );
  check("Owner can change a Farm A member role", roleChange.status === 200);
  const changedRole = await adminRows("farm_memberships", {
    farm_id: `eq.${farmA}`,
    user_id: `eq.${staff.accountant.id}`,
  }, "role");
  check("Authorized role change is persisted", changedRole[0]?.role === "manager");

  const staleCookies = new Map(ownerA.cookies);
  const signOut = await requestApi("owner-a-sign-out", ownerA, "POST", "/api/auth/sign-out");
  check("Owner sign-out endpoint succeeds", signOut.status === 200);
  const replay = await requestApi(
    "owner-a-old-cookie-replay-after-sign-out",
    { cookies: staleCookies },
    "GET",
    "/api/farms",
  );
  check(
    "Old application cookie is rejected after sign-out",
    replay.status === 401,
    replay.status === 401 ? "old cookie rejected" : `unexpected status ${replay.status}`,
  );
}

try {
  await main();
} catch (error) {
  console.error("Security verification aborted:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
} finally {
  await cleanup();
  console.log(JSON.stringify({
    type: "summary",
    assertions: assertions.length,
    passed: assertions.filter((assertion) => assertion.passed).length,
    failed: assertions.filter((assertion) => !assertion.passed).length,
    cleanupFailed,
    cleanupRequiresProjectRetirement,
  }));
  if (assertions.some((assertion) => !assertion.passed) || cleanupFailed || cleanupRequiresProjectRetirement) {
    process.exitCode = 1;
  }
}
