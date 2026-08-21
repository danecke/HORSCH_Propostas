ALTER TABLE `reimbursement_approvals` ADD `line_id` integer REFERENCES reimbursement_sales(id);--> statement-breakpoint
ALTER TABLE `reimbursement_imports` ADD `tolerance_bps` integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `duplicate_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `base_source` text DEFAULT 'NET_PRICE_VIGENTE' NOT NULL;--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `base_status` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `reason_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `historical_margin_bps` integer;--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `margin_variation_bps` integer;--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `justification` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `justification_status` text DEFAULT '' NOT NULL;