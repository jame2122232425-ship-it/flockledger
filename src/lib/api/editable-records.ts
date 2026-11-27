import { z } from "zod";

type FieldRule = {
  column: string;
  schema: z.ZodType;
};

type EditableResource = {
  table: string;
  fields: string;
  deletable?: boolean;
  editableFields: Record<string, FieldRule>;
};

const field = (column: string, schema: z.ZodType): FieldRule => ({ column, schema });
const text = (column: string, max: number) => field(column, z.string().trim().max(max).nullable());
const requiredText = (column: string, max: number) => field(column, z.string().trim().min(1).max(max));
const date = (column: string) => field(column, z.iso.date());
const nullableDate = (column: string) => field(column, z.iso.date().nullable());
const number = (column: string) => field(column, z.number().min(0));
const nullableNumber = (column: string) => field(column, z.number().nullable());
const integer = (column: string) => field(column, z.number().int().min(0));
const boolean = (column: string) => field(column, z.boolean());

export const editableResources: Record<string, EditableResource> = {
  batches: {
    table: "batches",
    fields: "id, farm_id, batch_code, batch_type, rearing_system, house, date_placed, source, strain, chicks_ordered, chicks_received, date_sold_out, status, remarks, created_at",
    deletable: false,
    editableFields: {
      rearingSystem: text("rearing_system", 64),
      house: text("house", 64),
      source: text("source", 128),
      strain: text("strain", 128),
      remarks: text("remarks", 2000),
    },
  },
  "daily-records": {
    table: "daily_records",
    fields: "id, farm_id, batch_id, record_date, dead, culled, feed_given_kg, feed_left_kg, water_liters, temp_min_c, temp_max_c, litter, remarks, initials, created_at",
    editableFields: {
      recordDate: date("record_date"),
      dead: integer("dead"),
      culled: integer("culled"),
      feedGivenKg: number("feed_given_kg"),
      feedLeftKg: number("feed_left_kg"),
      waterLiters: number("water_liters"),
      tempMinC: nullableNumber("temp_min_c"),
      tempMaxC: nullableNumber("temp_max_c"),
      litter: text("litter", 128),
      remarks: text("remarks", 2000),
      initials: text("initials", 16),
    },
  },
  weights: {
    table: "weight_records",
    fields: "id, farm_id, batch_id, record_date, age_days, birds_weighed, total_weight_g, lightest_g, heaviest_g, target_g, uniform_count, initials, created_at",
    editableFields: {
      recordDate: date("record_date"),
      ageDays: integer("age_days"),
      birdsWeighed: field("birds_weighed", z.number().int().positive()),
      totalWeightG: field("total_weight_g", z.number().positive()),
      lightestG: nullableNumber("lightest_g"),
      heaviestG: nullableNumber("heaviest_g"),
      targetG: nullableNumber("target_g"),
      uniformCount: integer("uniform_count"),
      initials: text("initials", 16),
    },
  },
  "feed-deliveries": {
    table: "feed_deliveries",
    fields: "id, farm_id, batch_id, delivery_date, feed_type, bags, kg_per_bag, price_per_bag, invoice_number, supplier, created_at",
    editableFields: {
      deliveryDate: date("delivery_date"),
      feedType: requiredText("feed_type", 128),
      bags: field("bags", z.number().int().positive()),
      kgPerBag: field("kg_per_bag", z.number().positive()),
      pricePerBag: number("price_per_bag"),
      invoiceNumber: text("invoice_number", 64),
      supplier: text("supplier", 128),
    },
  },
  "health-records": {
    table: "health_records",
    fields: "id, farm_id, batch_id, record_date, record_type, disease_reason, product_name, product_details, vaccine_batch_number, product_expiry_date, dose_route, birds_affected, duration_days, withdrawal_days, cost_kes, given_by, reaction, post_mortem_findings, suspected_cause, action_taken, veterinarian_consulted, remarks, created_at",
    editableFields: {
      recordDate: date("record_date"),
      recordType: field("record_type", z.enum(["Vaccination", "Treatment", "Post-mortem"])),
      diseaseReason: text("disease_reason", 128),
      productName: text("product_name", 128),
      productDetails: text("product_details", 128),
      vaccineBatchNumber: text("vaccine_batch_number", 128),
      productExpiryDate: nullableDate("product_expiry_date"),
      doseRoute: text("dose_route", 128),
      birdsAffected: field("birds_affected", z.number().int().min(0).nullable()),
      durationDays: field("duration_days", z.number().int().min(0).nullable()),
      withdrawalDays: field("withdrawal_days", z.number().int().min(0).nullable()),
      costKes: number("cost_kes"),
      givenBy: text("given_by", 128),
      reaction: text("reaction", 1000),
      postMortemFindings: text("post_mortem_findings", 2000),
      suspectedCause: text("suspected_cause", 1000),
      actionTaken: text("action_taken", 2000),
      veterinarianConsulted: field("veterinarian_consulted", z.boolean().nullable()),
      remarks: text("remarks", 2000),
    },
  },
  inventory: {
    table: "inventory_items",
    fields: "id, farm_id, name, item_type, unit, reorder_level, expiry_date, created_at",
    editableFields: {
      name: requiredText("name", 128),
      itemType: requiredText("item_type", 64),
      unit: requiredText("unit", 32),
      reorderLevel: number("reorder_level"),
      expiryDate: nullableDate("expiry_date"),
    },
  },
  "stock-movements": {
    table: "stock_movements",
    fields: "id, farm_id, item_id, batch_id, movement_date, received, used, supplier, invoice_number, expiry_date, remarks, created_at",
    editableFields: {
      movementDate: date("movement_date"),
      received: number("received"),
      used: number("used"),
      supplier: text("supplier", 128),
      invoiceNumber: text("invoice_number", 64),
      expiryDate: nullableDate("expiry_date"),
      remarks: text("remarks", 2000),
    },
  },
  assets: {
    table: "assets",
    fields: "id, farm_id, name, date_purchased, cost_kes, useful_life_years, salvage_value_kes, remarks, created_at",
    editableFields: {
      name: requiredText("name", 128),
      datePurchased: date("date_purchased"),
      costKes: number("cost_kes"),
      usefulLifeYears: field("useful_life_years", z.number().positive()),
      salvageValueKes: number("salvage_value_kes"),
      remarks: text("remarks", 2000),
    },
  },
  "brooding-observations": {
    table: "brooding_observations",
    fields: "id, farm_id, batch_id, observation_date, observation_time, brooder_temp_c, house_temp_c, humidity_percent, chick_behavior, behavior_details, action_taken, initials, created_at",
    editableFields: {
      observationDate: date("observation_date"),
      observationTime: field("observation_time", z.iso.time()),
      brooderTempC: nullableNumber("brooder_temp_c"),
      houseTempC: nullableNumber("house_temp_c"),
      humidityPercent: field("humidity_percent", z.number().min(0).max(100).nullable()),
      chickBehavior: field("chick_behavior", z.enum(["spread", "huddled", "panting", "other"]).nullable()),
      behaviorDetails: text("behavior_details", 1000),
      actionTaken: text("action_taken", 2000),
      initials: text("initials", 16),
    },
  },
  "biosecurity-visits": {
    table: "biosecurity_visits",
    fields: "id, farm_id, visit_date, time_in, visitor_name, organization_purpose, last_poultry_premises, footbath_used, protective_clothing_used, signature, created_at",
    editableFields: {
      visitDate: date("visit_date"),
      timeIn: field("time_in", z.iso.time()),
      visitorName: requiredText("visitor_name", 128),
      organizationPurpose: text("organization_purpose", 255),
      lastPoultryPremises: text("last_poultry_premises", 255),
      footbathUsed: boolean("footbath_used"),
      protectiveClothingUsed: boolean("protective_clothing_used"),
      signature: text("signature", 128),
    },
  },
  "house-activities": {
    table: "house_activity_records",
    fields: "id, farm_id, batch_id, activity_date, house, activity_type, litter_condition, ammonia_observation, disinfectant, downtime_start, downtime_end, remarks, created_at",
    editableFields: {
      activityDate: date("activity_date"),
      house: requiredText("house", 64),
      activityType: field("activity_type", z.enum(["litter_check", "cleanout", "disinfection", "downtime"])),
      litterCondition: text("litter_condition", 128),
      ammoniaObservation: text("ammonia_observation", 255),
      disinfectant: text("disinfectant", 128),
      downtimeStart: nullableDate("downtime_start"),
      downtimeEnd: nullableDate("downtime_end"),
      remarks: text("remarks", 2000),
    },
  },
  "labour-records": {
    table: "labour_records",
    fields: "id, farm_id, batch_id, record_type, record_date, worker_name, hours_worked, pay_period_start, pay_period_end, amount_kes, remarks, created_at",
    editableFields: {
      recordType: field("record_type", z.enum(["attendance", "payroll"])),
      recordDate: date("record_date"),
      workerName: requiredText("worker_name", 128),
      hoursWorked: field("hours_worked", z.number().min(0).nullable()),
      payPeriodStart: nullableDate("pay_period_start"),
      payPeriodEnd: nullableDate("pay_period_end"),
      amountKes: number("amount_kes"),
      remarks: text("remarks", 2000),
    },
  },
  "utility-usage": {
    table: "utility_usage",
    fields: "id, farm_id, batch_id, usage_date, house, utility_type, quantity, unit, meter_reading, remarks, created_at",
    editableFields: {
      usageDate: date("usage_date"),
      house: text("house", 64),
      utilityType: field("utility_type", z.enum(["electricity", "water", "fuel", "gas", "charcoal", "other"])),
      quantity: number("quantity"),
      unit: requiredText("unit", 32),
      meterReading: nullableNumber("meter_reading"),
      remarks: text("remarks", 2000),
    },
  },
  "maintenance-records": {
    table: "maintenance_records",
    fields: "id, farm_id, batch_id, asset_id, record_date, house, description, work_done, service_provider, status, remarks, created_at",
    editableFields: {
      recordDate: date("record_date"),
      house: text("house", 64),
      description: requiredText("description", 255),
      workDone: text("work_done", 2000),
      serviceProvider: text("service_provider", 128),
      status: field("status", z.enum(["reported", "in_progress", "completed"])),
      remarks: text("remarks", 2000),
    },
  },
  "compliance-records": {
    table: "compliance_records",
    fields: "id, farm_id, document_type, document_number, issuing_authority, issued_date, expiry_date, storage_path, remarks, created_at",
    editableFields: {
      documentType: requiredText("document_type", 128),
      documentNumber: text("document_number", 128),
      issuingAuthority: text("issuing_authority", 128),
      issuedDate: nullableDate("issued_date"),
      expiryDate: nullableDate("expiry_date"),
      storagePath: text("storage_path", 512),
      remarks: text("remarks", 2000),
    },
  },
};
