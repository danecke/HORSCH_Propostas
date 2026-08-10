CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`dealership_id` integer NOT NULL,
	`created_by_email` text NOT NULL,
	`created_by_name` text DEFAULT '' NOT NULL,
	`customer_name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`machine_domain` text DEFAULT '' NOT NULL,
	`parts_of_interest` text DEFAULT '' NOT NULL,
	`temperature` text DEFAULT 'warm' NOT NULL,
	`stage` text DEFAULT 'new' NOT NULL,
	`negotiated_value_cents` integer DEFAULT 0 NOT NULL,
	`invoice_number` text DEFAULT '' NOT NULL,
	`seller_name` text DEFAULT '' NOT NULL,
	`seller_email` text DEFAULT '' NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `leads_dealership_idx` ON `leads` (`dealership_id`);--> statement-breakpoint
CREATE INDEX `leads_stage_idx` ON `leads` (`stage`);--> statement-breakpoint
CREATE INDEX `leads_temperature_idx` ON `leads` (`temperature`);--> statement-breakpoint
CREATE INDEX `leads_seller_idx` ON `leads` (`seller_email`);--> statement-breakpoint
CREATE INDEX `leads_updated_at_idx` ON `leads` (`updated_at`);--> statement-breakpoint
INSERT INTO `dealership_module_access` (`dealership_id`, `module_key`, `enabled`, `updated_by_email`)
SELECT `id`, 'leads', 1, '' FROM `dealerships`
WHERE NOT EXISTS (
  SELECT 1 FROM `dealership_module_access` a
  WHERE a.`dealership_id` = `dealerships`.`id` AND a.`module_key` = 'leads'
);
