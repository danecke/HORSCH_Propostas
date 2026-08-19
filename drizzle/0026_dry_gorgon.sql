ALTER TABLE `proposals` ADD `requested_net_price_cents` integer;--> statement-breakpoint
ALTER TABLE `proposals` ADD `claimed_by_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `claimed_at` text;--> statement-breakpoint
ALTER TABLE `proposals` ADD `pdf_visualized` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `rejection_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `erp_order_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `official_pdf_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `factory_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `factory_vt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `factory_origin` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `factory_ncm` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `offer_net_price_cents` integer;--> statement-breakpoint
ALTER TABLE `proposals` ADD `offer_invoice_unit_price_cents` integer;--> statement-breakpoint
ALTER TABLE `proposals` ADD `offer_valid_until` text;