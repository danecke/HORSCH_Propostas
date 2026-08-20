CREATE TABLE `quote_outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_outbox_idempotency_idx` ON `quote_outbox_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `quote_outbox_status_idx` ON `quote_outbox_events` (`status`);