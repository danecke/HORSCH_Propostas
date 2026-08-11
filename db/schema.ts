import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const dealerships = sqliteTable(
  "dealerships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    parentDealershipId: integer("parent_dealership_id").references(() => dealerships.id, {
      onDelete: "set null",
    }),
    contactName: text("contact_name").notNull().default(""),
    contactEmail: text("contact_email").notNull().default(""),
    factoryManagerEmail: text("factory_manager_email").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("dealerships_name_idx").on(table.name)],
);

export const dealershipModuleAccess = sqliteTable(
  "dealership_module_access",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealershipId: integer("dealership_id")
      .notNull()
      .references(() => dealerships.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    updatedByEmail: text("updated_by_email").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("dealership_module_access_unique").on(table.dealershipId, table.moduleKey),
    index("dealership_module_access_dealership_idx").on(table.dealershipId),
  ],
);

export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    dealershipId: integer("dealership_id")
      .notNull()
      .references(() => dealerships.id),
    contactName: text("contact_name").notNull().default(""),
    contactEmail: text("contact_email").notNull().default(""),
    commercialOwner: text("commercial_owner").notNull(),
    commercialOwnerEmail: text("commercial_owner_email").notNull().default(""),
    status: text("status").notNull().default("draft"),
    issueDate: text("issue_date").notNull(),
    validUntil: text("valid_until").notNull(),
    totalCents: integer("total_cents").notNull().default(0),
    customerName: text("customer_name").notNull().default(""),
    customerSaleValueCents: integer("customer_sale_value_cents"),
    counterofferCents: integer("counteroffer_cents"),
    decisionNote: text("decision_note").notNull().default(""),
    decidedByEmail: text("decided_by_email").notNull().default(""),
    counterofferPaymentTerms: text("counteroffer_payment_terms").notNull().default(""),
    counterofferFreightTerms: text("counteroffer_freight_terms").notNull().default(""),
    counterofferDeliveryTerms: text("counteroffer_delivery_terms").notNull().default(""),
    counterofferSubmittedAt: text("counteroffer_submitted_at"),
    counterofferReviewedAt: text("counteroffer_reviewed_at"),
    counterofferReviewedByEmail: text("counteroffer_reviewed_by_email").notNull().default(""),
    counterofferReviewNote: text("counteroffer_review_note").notNull().default(""),
    emailStatus: text("email_status").notNull().default("not_requested"),
    emailSentAt: text("email_sent_at"),
    emailError: text("email_error").notNull().default(""),
    createdByEmail: text("created_by_email").notNull(),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("proposals_dealership_idx").on(table.dealershipId),
    index("proposals_status_idx").on(table.status),
    index("proposals_created_at_idx").on(table.createdAt),
  ],
);

export const users = sqliteTable(
  "users",
  {
    email: text("email").primaryKey(),
    name: text("name").notNull().default(""),
    role: text("role").notNull(),
    dealershipId: integer("dealership_id").references(() => dealerships.id, {
      onDelete: "set null",
    }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    passwordHash: text("password_hash").notNull().default(""),
    passwordSalt: text("password_salt").notNull().default(""),
    passwordIterations: integer("password_iterations").notNull().default(0),
    createdByEmail: text("created_by_email").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("users_role_idx").on(table.role),
    index("users_dealership_idx").on(table.dealershipId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userEmail: text("user_email")
      .notNull()
      .references(() => users.email, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("sessions_user_idx").on(table.userEmail),
    index("sessions_expires_idx").on(table.expiresAt),
  ],
);

export const proposalItems = sqliteTable(
  "proposal_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    partNumber: text("part_number").notNull(),
    description: text("description").notNull(),
    vt: text("vt").notNull().default(""),
    origin: text("origin").notNull().default(""),
    ncm: text("ncm").notNull().default(""),
    quantity: integer("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    // The database column is preserved for compatibility with existing proposals;
    // semantically this value is the unit NF price.
    invoiceUnitPriceCents: integer("invoice_total_cents"),
    counterofferQuantity: integer("counteroffer_quantity"),
    counterofferUnitPriceCents: integer("counteroffer_unit_price_cents"),
  },
  (table) => [index("proposal_items_proposal_idx").on(table.proposalId)],
);

export const proposalDocuments = sqliteTable(
  "proposal_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("other"),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    storageKey: text("storage_key").notNull(),
    uploadedByEmail: text("uploaded_by_email").notNull(),
    uploadedByName: text("uploaded_by_name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("proposal_documents_proposal_idx").on(table.proposalId),
    index("proposal_documents_created_at_idx").on(table.createdAt),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proposalId: text("proposal_id"),
    actorEmail: text("actor_email").notNull(),
    actorName: text("actor_name").notNull().default(""),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    details: text("details").notNull().default(""),
    beforeJson: text("before_json").notNull().default(""),
    afterJson: text("after_json").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_logs_proposal_idx").on(table.proposalId),
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_actor_idx").on(table.actorEmail),
  ],
);

export const quoteCatalog = sqliteTable("quote_catalog", {
  partNumber: text("part_number").primaryKey(),
  description: text("description").notNull().default(""),
  vt: text("vt").notNull().default(""),
  origin: text("origin").notNull().default(""),
  netPriceCents: integer("net_price_cents").notNull().default(0),
  importedAt: text("imported_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("quote_catalog_imported_idx").on(table.importedAt)]);

export const quoteRequests = sqliteTable("quote_requests", {
  id: text("id").primaryKey(),
  partNumber: text("part_number").notNull(),
  dealershipId: integer("dealership_id").notNull().references(() => dealerships.id),
  requestedByEmail: text("requested_by_email").notNull(),
  requestedByName: text("requested_by_name").notNull().default(""),
  requestedQuantity: integer("requested_quantity").notNull().default(1),
  targetNetPriceCents: integer("target_net_price_cents"),
  requestObservation: text("request_observation").notNull().default(""),
  approvedQuantity: integer("approved_quantity"),
  status: text("status").notNull().default("global_review"),
  actionOwnerRole: text("action_owner_role").notNull().default("global_management"),
  actionOwnerEmail: text("action_owner_email").notNull().default(""),
  description: text("description").notNull().default(""),
  vt: text("vt").notNull().default(""),
  origin: text("origin").notNull().default(""),
  netPriceCents: integer("net_price_cents"),
  catalogImportedAt: text("catalog_imported_at"),
  actionNote: text("action_note").notNull().default(""),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  returnedAt: text("returned_at"),
  decidedAt: text("decided_at"),
  decidedByEmail: text("decided_by_email").notNull().default(""),
  factoryActionAt: text("factory_action_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("quote_requests_dealership_idx").on(table.dealershipId),
  index("quote_requests_status_idx").on(table.status),
  index("quote_requests_part_number_idx").on(table.partNumber),
  index("quote_requests_updated_at_idx").on(table.updatedAt),
]);

export const quotePriceListControl = sqliteTable("quote_price_list_control", {
  partNumber: text("part_number").primaryKey(),
  includedAt: text("included_at").notNull(),
  includedByEmail: text("included_by_email").notNull(),
});

export const priceListImports = sqliteTable("price_list_imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull().default(""),
  contentType: text("content_type").notNull().default("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  rowCount: integer("row_count").notNull().default(0),
  statesJson: text("states_json").notNull().default("[]"),
  importedByEmail: text("imported_by_email").notNull(),
  importedByName: text("imported_by_name").notNull().default(""),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("price_list_imports_active_idx").on(table.isActive), index("price_list_imports_imported_at_idx").on(table.importedAt)]);

export const priceListItems = sqliteTable("price_list_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  importId: integer("import_id").notNull().references(() => priceListImports.id, { onDelete: "cascade" }),
  partNumber: text("part_number").notNull(),
  description: text("description").notNull().default(""),
  family: text("family").notNull().default(""),
  unit: text("unit").notNull().default(""),
  ncm: text("ncm").notNull().default(""),
  vt: text("vt").notNull().default(""),
  origin: text("origin").notNull().default(""),
  netPriceCents: integer("net_price_cents").notNull().default(0),
  statePricesJson: text("state_prices_json").notNull().default("{}"),
  importedAt: text("imported_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("price_list_items_import_idx").on(table.importId),
  index("price_list_items_part_number_idx").on(table.partNumber),
]);

export const proposalRequests = sqliteTable("proposal_requests", {
  id: text("id").primaryKey(),
  dealershipId: integer("dealership_id").notNull().references(() => dealerships.id),
  requestedByEmail: text("requested_by_email").notNull(),
  requestedByName: text("requested_by_name").notNull().default(""),
  partNumber: text("part_number").notNull(),
  description: text("description").notNull(),
  targetNetPriceCents: integer("target_net_price_cents").notNull(),
  observation: text("observation").notNull().default(""),
  status: text("status").notNull().default("requested"),
  actionOwnerEmail: text("action_owner_email").notNull().default(""),
  responseNetPriceCents: integer("response_net_price_cents"),
  responseObservation: text("response_observation").notNull().default(""),
  respondedByEmail: text("responded_by_email").notNull().default(""),
  respondedAt: text("responded_at"),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("proposal_requests_dealership_idx").on(table.dealershipId),
  index("proposal_requests_status_idx").on(table.status),
  index("proposal_requests_updated_at_idx").on(table.updatedAt),
]);

export const leads = sqliteTable("leads", {
  id: text("id").primaryKey(),
  dealershipId: integer("dealership_id").notNull().references(() => dealerships.id, { onDelete: "cascade" }),
  createdByEmail: text("created_by_email").notNull(),
  createdByName: text("created_by_name").notNull().default(""),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  machineDomain: text("machine_domain").notNull().default(""),
  partNumbers: text("part_numbers").notNull().default(""),
  partsOfInterest: text("parts_of_interest").notNull().default(""),
  temperature: text("temperature").notNull().default("warm"),
  stage: text("stage").notNull().default("new"),
  negotiatedValueCents: integer("negotiated_value_cents").notNull().default(0),
  invoiceNumber: text("invoice_number").notNull().default(""),
  invoiceValueCents: integer("invoice_value_cents").notNull().default(0),
  sellerName: text("seller_name").notNull().default(""),
  sellerEmail: text("seller_email").notNull().default(""),
  closedAt: text("closed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("leads_dealership_idx").on(table.dealershipId),
  index("leads_stage_idx").on(table.stage),
  index("leads_temperature_idx").on(table.temperature),
  index("leads_seller_idx").on(table.sellerEmail),
  index("leads_updated_at_idx").on(table.updatedAt),
]);
