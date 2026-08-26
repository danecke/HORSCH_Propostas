ALTER TABLE `proposals` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `proposals` ADD `source_lead_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `quote_requests` ADD `source_lead_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD `converted_entity_type` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD `converted_entity_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD `rollback_pending` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `leads` ADD `rollback_reason` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `workflow_route` text DEFAULT 'exception' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `workflow_status` text DEFAULT 'awaiting_global' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `auto_check_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `global_decision_by_email` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `global_decision_at` text;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `dealer_consent_by_email` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `dealer_consent_at` text;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `settled_by_email` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `settled_at` text;
--> statement-breakpoint
ALTER TABLE `reimbursement_sales` ADD `settlement_document_number` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `proposals_source_lead_idx` ON `proposals` (`source_lead_id`);
--> statement-breakpoint
CREATE INDEX `quote_requests_source_lead_idx` ON `quote_requests` (`source_lead_id`);
--> statement-breakpoint
CREATE INDEX `leads_rollback_pending_idx` ON `leads` (`rollback_pending`);
--> statement-breakpoint
CREATE INDEX `reimbursement_sales_workflow_status_idx` ON `reimbursement_sales` (`workflow_status`);
