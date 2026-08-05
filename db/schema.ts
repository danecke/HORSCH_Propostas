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
    contactName: text("contact_name").notNull().default(""),
    contactEmail: text("contact_email").notNull().default(""),
    factoryManagerEmail: text("factory_manager_email").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("dealerships_name_idx").on(table.name)],
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
