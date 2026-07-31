CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_email`) REFERENCES `users`(`email`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_email`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `password_salt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `password_iterations` integer DEFAULT 0 NOT NULL;