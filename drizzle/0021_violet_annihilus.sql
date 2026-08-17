CREATE TABLE `price_list_notification_recipients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notification_id` integer NOT NULL,
	`recipient_email` text NOT NULL,
	`recipient_name` text DEFAULT '' NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `price_list_notifications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_list_notification_recipient_unique` ON `price_list_notification_recipients` (`notification_id`,`recipient_email`);--> statement-breakpoint
CREATE INDEX `price_list_notification_recipient_email_idx` ON `price_list_notification_recipients` (`recipient_email`);--> statement-breakpoint
CREATE INDEX `price_list_notification_recipient_unread_idx` ON `price_list_notification_recipients` (`recipient_email`,`read_at`);--> statement-breakpoint
CREATE INDEX `price_list_notification_recipient_notification_idx` ON `price_list_notification_recipients` (`notification_id`);--> statement-breakpoint
CREATE TABLE `price_list_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`effective_at` text NOT NULL,
	`affected_pns` text DEFAULT '' NOT NULL,
	`audience` text DEFAULT 'all' NOT NULL,
	`created_by_email` text NOT NULL,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_list_notifications_created_at_idx` ON `price_list_notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `price_list_notifications_effective_at_idx` ON `price_list_notifications` (`effective_at`);