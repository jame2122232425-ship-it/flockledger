const farmAuditColumns = [
  "id",
  "farm_id",
  "table_name",
  "record_id",
  "operation",
  "actor_id",
  "old_data",
  "new_data",
  "occurred_at",
] as const;

const platformAuditColumns = [
  "id",
  "event_type",
  "application_id",
  "farm_id",
  "actor_user_id",
  "reason",
  "details",
  "request_id",
  "occurred_at",
] as const;

export function auditCsv(
  rows: Array<Record<string, unknown>>,
  scope: "farm" | "platform" = "farm",
) {
  const columns = scope === "platform" ? platformAuditColumns : farmAuditColumns;
  const cell = (value: unknown) => {
    let text = value == null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value) ?? String(value);
    if (typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    columns.map(cell).join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column])).join(",")),
  ].join("\r\n");
}
