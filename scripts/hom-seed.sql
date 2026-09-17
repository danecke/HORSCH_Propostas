-- Seed de HOMOLOGAÇÃO: admin de teste para o portal Gestão de Propostas.
-- Aplicado pelo scripts/bootstrap-hom.sh (apenas em hom, nunca em produção).
-- Login: admin.hom@horsch.com.br / Senha: HorschHom2026!
-- Hash PBKDF2-SHA256, 100000 iterações, 32 bytes — mesmo formato de lib/auth.ts.
INSERT INTO `users` (
  `email`, `name`, `role`, `dealership_id`, `active`,
  `password_hash`, `password_salt`, `password_iterations`,
  `created_by_email`, `created_at`, `updated_at`
) VALUES (
  'admin.hom@horsch.com.br',
  'Admin Homologação',
  'general_admin',
  NULL,
  1,
  '5GGOxTVFLTVq6fEPN320wkqaBCamhaTSGi5Ld6Yb3gw=',
  '3rF0qPLNVdtaiSHVmPQ9iw==',
  100000,
  'admin.hom@horsch.com.br',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(`email`) DO UPDATE SET
  `role` = 'general_admin',
  `active` = 1,
  `password_hash` = excluded.`password_hash`,
  `password_salt` = excluded.`password_salt`,
  `password_iterations` = excluded.`password_iterations`,
  `updated_at` = CURRENT_TIMESTAMP;
