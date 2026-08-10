ALTER TABLE `dealerships` ADD `postal_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `dealerships` ADD `parent_dealership_id` integer REFERENCES dealerships(id);