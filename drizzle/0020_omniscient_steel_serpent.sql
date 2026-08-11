CREATE TABLE `price_list_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`storage_key` text DEFAULT '' NOT NULL,
	`content_type` text DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`states_json` text DEFAULT '[]' NOT NULL,
	`imported_by_email` text NOT NULL,
	`imported_by_name` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_list_imports_active_idx` ON `price_list_imports` (`is_active`);--> statement-breakpoint
CREATE INDEX `price_list_imports_imported_at_idx` ON `price_list_imports` (`imported_at`);--> statement-breakpoint
CREATE TABLE `price_list_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` integer NOT NULL,
	`part_number` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`family` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`ncm` text DEFAULT '' NOT NULL,
	`vt` text DEFAULT '' NOT NULL,
	`origin` text DEFAULT '' NOT NULL,
	`net_price_cents` integer DEFAULT 0 NOT NULL,
	`state_prices_json` text DEFAULT '{}' NOT NULL,
	`imported_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `price_list_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `price_list_items_import_idx` ON `price_list_items` (`import_id`);--> statement-breakpoint
CREATE INDEX `price_list_items_part_number_idx` ON `price_list_items` (`part_number`);