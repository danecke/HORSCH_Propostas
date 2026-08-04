CREATE TABLE `audit_logs` (
`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
`proposal_id` text,
`actor_email` text NOT NULL,
`actor_name` text DEFAULT '' NOT NULL,
`action` text NOT NULL,
`entity` text NOT NULL,
`details` text DEFAULT '' NOT NULL,
`before_json` text DEFAULT '' NOT NULL,
`after_json` text DEFAULT '' NOT NULL,
`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_proposal_idx` ON `audit_logs` (`proposal_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_email`);
