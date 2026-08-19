CREATE TABLE `user_dealerships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`dealership_id` integer NOT NULL,
	`created_by_email` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_email`) REFERENCES `users`(`email`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_dealerships_unique` ON `user_dealerships` (`user_email`,`dealership_id`);--> statement-breakpoint
CREATE INDEX `user_dealerships_user_idx` ON `user_dealerships` (`user_email`);--> statement-breakpoint
CREATE INDEX `user_dealerships_dealership_idx` ON `user_dealerships` (`dealership_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `user_dealerships` (`user_email`, `dealership_id`, `created_by_email`)
SELECT `email`, `dealership_id`, `created_by_email` FROM `users` WHERE `dealership_id` IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `user_dealerships` (`user_email`, `dealership_id`, `created_by_email`)
SELECT `users`.`email`, `dealerships`.`id`, `users`.`created_by_email`
FROM `users` INNER JOIN `dealerships` ON lower(`users`.`email`) = lower(`dealerships`.`factory_manager_email`)
WHERE `users`.`role` = 'factory_manager' AND `dealerships`.`factory_manager_email` <> '';
