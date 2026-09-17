-- Correção de homologação: o role legado 'admin' é normalizado para
-- 'concession' pelo app (menu consultivo). O admin de teste deve ser
-- ADM Geral ('general_admin').
UPDATE `users` SET `role` = 'general_admin', `updated_at` = CURRENT_TIMESTAMP
WHERE `email` = 'admin.hom@horsch.com.br';
