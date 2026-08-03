UPDATE `users`
SET `role` = 'user', `updated_at` = CURRENT_TIMESTAMP
WHERE `role` = 'admin' AND lower(`email`) <> 'mateus.mazieiro@horsch.com';
--> statement-breakpoint
INSERT INTO `users` (
  `email`,
  `name`,
  `role`,
  `dealership_id`,
  `active`,
  `password_hash`,
  `password_salt`,
  `password_iterations`,
  `created_by_email`,
  `created_at`,
  `updated_at`
) VALUES (
  'mateus.mazieiro@horsch.com',
  'Mateus Mazieiro',
  'admin',
  NULL,
  1,
  'LfpMJ6hqa2gkITvOu3pOXLCwAqvhxptPsLpBl1viK8o=',
  'u+2tGYt9pjNpVuoW58lmWQ==',
  100000,
  'mateus.mazieiro@horsch.com',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(`email`) DO UPDATE SET
  `name` = excluded.`name`,
  `role` = 'admin',
  `dealership_id` = NULL,
  `active` = 1,
  `password_hash` = excluded.`password_hash`,
  `password_salt` = excluded.`password_salt`,
  `password_iterations` = excluded.`password_iterations`,
  `updated_at` = CURRENT_TIMESTAMP;
