CREATE TABLE IF NOT EXISTS `reimbursement_settings` (
`setting_key` text PRIMARY KEY NOT NULL,
`numeric_value` integer NOT NULL,
`updated_by_email` text DEFAULT 'system' NOT NULL,
`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `reimbursement_settings` (`setting_key`, `numeric_value`, `updated_by_email`, `updated_at`)
VALUES ('n3_tolerance_bps', 500, 'system', CURRENT_TIMESTAMP);
