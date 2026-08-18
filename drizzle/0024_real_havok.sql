ALTER TABLE `leads` ADD `lost_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quote_catalog` ADD `ncm` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quote_requests` ADD `ncm` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quote_requests` ADD `horsch_order_number` text DEFAULT '' NOT NULL;