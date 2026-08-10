CREATE TABLE `proposal_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`dealership_id` integer NOT NULL,
	`requested_by_email` text NOT NULL,
	`requested_by_name` text DEFAULT '' NOT NULL,
	`part_number` text NOT NULL,
	`description` text NOT NULL,
	`target_net_price_cents` integer NOT NULL,
	`observation` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`action_owner_email` text DEFAULT '' NOT NULL,
	`response_net_price_cents` integer,
	`response_observation` text DEFAULT '' NOT NULL,
	`responded_by_email` text DEFAULT '' NOT NULL,
	`responded_at` text,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `proposal_requests_dealership_idx` ON `proposal_requests` (`dealership_id`);--> statement-breakpoint
CREATE INDEX `proposal_requests_status_idx` ON `proposal_requests` (`status`);--> statement-breakpoint
CREATE INDEX `proposal_requests_updated_at_idx` ON `proposal_requests` (`updated_at`);