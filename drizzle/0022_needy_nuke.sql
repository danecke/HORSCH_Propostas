CREATE TABLE `machine_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `machine_models_name_idx` ON `machine_models` (`name`);--> statement-breakpoint
CREATE INDEX `machine_models_active_idx` ON `machine_models` (`active`);