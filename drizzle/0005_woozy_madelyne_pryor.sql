ALTER TABLE `proposal_items` ADD `counteroffer_quantity` integer;--> statement-breakpoint
ALTER TABLE `proposal_items` ADD `counteroffer_unit_price_cents` integer;--> statement-breakpoint
ALTER TABLE `proposals` ADD `counteroffer_payment_terms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `counteroffer_freight_terms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `counteroffer_delivery_terms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `counteroffer_submitted_at` text;--> statement-breakpoint
ALTER TABLE `proposals` ADD `counteroffer_reviewed_at` text;--> statement-breakpoint
ALTER TABLE `proposals` ADD `counteroffer_reviewed_by_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `counteroffer_review_note` text DEFAULT '' NOT NULL;