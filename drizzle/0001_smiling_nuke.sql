DELETE FROM `proposal_items`;
--> statement-breakpoint
DELETE FROM `proposals`;
--> statement-breakpoint
DELETE FROM `dealerships`;
--> statement-breakpoint
CREATE TABLE `users` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	`dealership_id` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_by_email` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_dealership_idx` ON `users` (`dealership_id`);--> statement-breakpoint
ALTER TABLE `dealerships` ADD `factory_manager_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `counteroffer_cents` integer;--> statement-breakpoint
ALTER TABLE `proposals` ADD `decision_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `decided_by_email` text DEFAULT '' NOT NULL;
