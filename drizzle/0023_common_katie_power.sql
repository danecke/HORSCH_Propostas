CREATE TABLE `reimbursement_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` integer NOT NULL,
	`action` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`actor_email` text NOT NULL,
	`actor_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `reimbursement_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reimbursement_approvals_import_idx` ON `reimbursement_approvals` (`import_id`);--> statement-breakpoint
CREATE INDEX `reimbursement_approvals_created_at_idx` ON `reimbursement_approvals` (`created_at`);--> statement-breakpoint
CREATE TABLE `reimbursement_clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`legal_name` text NOT NULL,
	`cnpj` text NOT NULL,
	`state` text NOT NULL,
	`client_type` text DEFAULT '' NOT NULL,
	`n2` integer DEFAULT false NOT NULL,
	`n3` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_email` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reimbursement_clients_cnpj_state_idx` ON `reimbursement_clients` (`cnpj`,`state`);--> statement-breakpoint
CREATE INDEX `reimbursement_clients_state_idx` ON `reimbursement_clients` (`state`);--> statement-breakpoint
CREATE INDEX `reimbursement_clients_status_idx` ON `reimbursement_clients` (`status`);--> statement-breakpoint
CREATE TABLE `reimbursement_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`storage_key` text DEFAULT '' NOT NULL,
	`content_type` text DEFAULT '' NOT NULL,
	`dealership_id` integer,
	`price_list_import_id` integer,
	`row_count` integer DEFAULT 0 NOT NULL,
	`total_quantity` integer DEFAULT 0 NOT NULL,
	`total_sales_cents` integer DEFAULT 0 NOT NULL,
	`total_cost_cents` integer DEFAULT 0 NOT NULL,
	`total_reimbursement_n2_cents` integer DEFAULT 0 NOT NULL,
	`total_reimbursement_n3_cents` integer DEFAULT 0 NOT NULL,
	`total_negotiation_cents` integer DEFAULT 0 NOT NULL,
	`tolerance_cents` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'processed' NOT NULL,
	`uploaded_by_email` text NOT NULL,
	`uploaded_by_name` text DEFAULT '' NOT NULL,
	`decision_note` text DEFAULT '' NOT NULL,
	`decided_by_email` text DEFAULT '' NOT NULL,
	`decided_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`price_list_import_id`) REFERENCES `price_list_imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reimbursement_imports_dealership_idx` ON `reimbursement_imports` (`dealership_id`);--> statement-breakpoint
CREATE INDEX `reimbursement_imports_status_idx` ON `reimbursement_imports` (`status`);--> statement-breakpoint
CREATE INDEX `reimbursement_imports_created_at_idx` ON `reimbursement_imports` (`created_at`);--> statement-breakpoint
CREATE TABLE `reimbursement_sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` integer NOT NULL,
	`dealership_id` integer,
	`client_id` integer,
	`price_list_import_id` integer,
	`part_number` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`cost_avg_unit_cents` integer DEFAULT 0 NOT NULL,
	`sale_net_unit_cents` integer DEFAULT 0 NOT NULL,
	`invoice_unit_cents` integer DEFAULT 0 NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`client_cnpj` text DEFAULT '' NOT NULL,
	`invoice_number` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`dealership_name` text DEFAULT '' NOT NULL,
	`margin_bps` integer DEFAULT 0 NOT NULL,
	`cost_total_cents` integer DEFAULT 0 NOT NULL,
	`liquid_total_cents` integer DEFAULT 0 NOT NULL,
	`net_price_used_cents` integer,
	`calculation_base_cents` integer DEFAULT 0 NOT NULL,
	`reimbursement_cents` integer DEFAULT 0 NOT NULL,
	`reimbursement_program` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'N2 Não Elegível' NOT NULL,
	`negotiation_cents` integer DEFAULT 0 NOT NULL,
	`expected_n3_cents` integer,
	`price_difference_cents` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `reimbursement_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`client_id`) REFERENCES `reimbursement_clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`price_list_import_id`) REFERENCES `price_list_imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reimbursement_sales_import_idx` ON `reimbursement_sales` (`import_id`);--> statement-breakpoint
CREATE INDEX `reimbursement_sales_dealership_idx` ON `reimbursement_sales` (`dealership_id`);--> statement-breakpoint
CREATE INDEX `reimbursement_sales_pn_idx` ON `reimbursement_sales` (`part_number`);--> statement-breakpoint
CREATE INDEX `reimbursement_sales_status_idx` ON `reimbursement_sales` (`status`);--> statement-breakpoint
CREATE INDEX `reimbursement_sales_invoice_idx` ON `reimbursement_sales` (`invoice_number`);