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
    commercialOwner: text("commercial_owner").notNull(),
    status: text("status").notNull().default("draft"),
    issueDate: text("issue_date").notNull(),
    validUntil: text("valid_until").notNull(),
    totalCents: integer("total_cents").notNull().default(0),
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

export const proposalItems = sqliteTable(
  "proposal_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    partNumber: text("part_number").notNull(),
    description: text("description").notNull(),
    origin: text("origin").notNull().default(""),
    ncm: text("ncm").notNull().default(""),
    quantity: integer("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
  },
  (table) => [index("proposal_items_proposal_idx").on(table.proposalId)],
);
