ALTER TABLE `quote_requests` ADD `requested_quantity` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `quote_requests` ADD `approved_quantity` integer;
--> statement-breakpoint
CREATE TABLE `quote_price_list_control` (
  `part_number` text PRIMARY KEY NOT NULL,
  `included_at` text NOT NULL,
  `included_by_email` text NOT NULL
);
