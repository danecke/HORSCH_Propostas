INSERT INTO `users` (
  `email`, `name`, `role`, `dealership_id`, `active`, `password_hash`, `password_salt`, `password_iterations`, `created_by_email`, `created_at`, `updated_at`
) VALUES (
  'teste.concessionaria@horsch.com', 'Teste Gestor Concessionária', 'dealer_manager', 1, 1,
  'quMHOPyECMFM2+XAHNuvjdrwOeKXKlQwcK4re3DjJZ0=', 'aG9yc2NoLXRlc3QtZGVhbGVyLTAx', 100000,
  'mateus.mazieiro@horsch.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT(`email`) DO NOTHING;
--> statement-breakpoint
INSERT INTO `users` (
  `email`, `name`, `role`, `dealership_id`, `active`, `password_hash`, `password_salt`, `password_iterations`, `created_by_email`, `created_at`, `updated_at`
) VALUES (
  'teste.gestao.global@horsch.com', 'Teste Gestão Global', 'global_management', NULL, 1,
  '4tif4ol7dIFpsAyo47hE/unJcsGTTYrKrCrcvg9QMMA=', 'aG9yc2NoLXRlc3QtZ2xvYmFsLTAx', 100000,
  'mateus.mazieiro@horsch.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT(`email`) DO NOTHING;
