ALTER TABLE `proposal_items` ADD `vt` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `proposal_items`
SET `vt` = substr(`description`, 1, instr(`description`, ' - ') - 1)
WHERE `vt` = '' AND lower(substr(`description`, 1, 2)) = 'vt' AND instr(`description`, ' - ') > 0;--> statement-breakpoint
UPDATE `proposal_items`
SET `description` = substr(`description`, instr(`description`, ' - ') + 3)
WHERE lower(substr(`description`, 1, 2)) = 'vt' AND instr(`description`, ' - ') > 0;--> statement-breakpoint
ALTER TABLE `proposals` ADD `contact_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `proposals`
SET `contact_email` = COALESCE(
  (SELECT `contact_email` FROM `dealerships` WHERE `dealerships`.`id` = `proposals`.`dealership_id`),
  ''
);--> statement-breakpoint
ALTER TABLE `proposals` ADD `email_status` text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE `proposals` ADD `email_sent_at` text;--> statement-breakpoint
ALTER TABLE `proposals` ADD `email_error` text DEFAULT '' NOT NULL;
