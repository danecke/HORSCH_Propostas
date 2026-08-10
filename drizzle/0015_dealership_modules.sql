CREATE TABLE IF NOT EXISTS `dealership_module_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dealership_id` integer NOT NULL REFERENCES `dealerships`(`id`) ON DELETE CASCADE,
	`module_key` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_by_email` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `dealership_module_access_unique` ON `dealership_module_access` (`dealership_id`,`module_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `dealership_module_access_dealership_idx` ON `dealership_module_access` (`dealership_id`);
--> statement-breakpoint
INSERT INTO `dealership_module_access` (`dealership_id`, `module_key`, `enabled`, `updated_by_email`)
SELECT `id`, 'proposals', 1, '' FROM `dealerships`
WHERE NOT EXISTS (SELECT 1 FROM `dealership_module_access` a WHERE a.`dealership_id` = `dealerships`.`id` AND a.`module_key` = 'proposals');
--> statement-breakpoint
INSERT INTO `dealership_module_access` (`dealership_id`, `module_key`, `enabled`, `updated_by_email`)
SELECT `id`, 'quotes', 1, '' FROM `dealerships`
WHERE NOT EXISTS (SELECT 1 FROM `dealership_module_access` a WHERE a.`dealership_id` = `dealerships`.`id` AND a.`module_key` = 'quotes');
--> statement-breakpoint
INSERT INTO `dealership_module_access` (`dealership_id`, `module_key`, `enabled`, `updated_by_email`)
SELECT `id`, 'price_list', 1, '' FROM `dealerships`
WHERE NOT EXISTS (SELECT 1 FROM `dealership_module_access` a WHERE a.`dealership_id` = `dealerships`.`id` AND a.`module_key` = 'price_list');
