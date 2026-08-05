CREATE TABLE `proposal_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposal_id` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`storage_key` text NOT NULL,
	`uploaded_by_email` text NOT NULL,
	`uploaded_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposal_documents_proposal_idx` ON `proposal_documents` (`proposal_id`);--> statement-breakpoint
CREATE INDEX `proposal_documents_created_at_idx` ON `proposal_documents` (`created_at`);--> statement-breakpoint
ALTER TABLE `proposals` ADD `customer_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `customer_sale_value_cents` integer;--> statement-breakpoint
