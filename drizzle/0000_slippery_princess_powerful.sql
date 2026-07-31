CREATE TABLE `dealerships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dealerships_name_idx` ON `dealerships` (`name`);--> statement-breakpoint
CREATE TABLE `proposal_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposal_id` text NOT NULL,
	`part_number` text NOT NULL,
	`description` text NOT NULL,
	`origin` text DEFAULT '' NOT NULL,
	`ncm` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposal_items_proposal_idx` ON `proposal_items` (`proposal_id`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`dealership_id` integer NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`commercial_owner` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`issue_date` text NOT NULL,
	`valid_until` text NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`created_by_email` text NOT NULL,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`dealership_id`) REFERENCES `dealerships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `proposals_dealership_idx` ON `proposals` (`dealership_id`);--> statement-breakpoint
CREATE INDEX `proposals_status_idx` ON `proposals` (`status`);--> statement-breakpoint
CREATE INDEX `proposals_created_at_idx` ON `proposals` (`created_at`);
--> statement-breakpoint
INSERT INTO `dealerships` (`id`, `name`, `city`, `state`, `contact_name`, `contact_email`) VALUES
  (1, 'Agro Sul Máquinas', 'Cascavel', 'PR', 'Ricardo Martins', 'ricardo@agrosul.example'),
  (2, 'Terra Forte Implementos', 'Rio Verde', 'GO', 'Mariana Lopes', 'mariana@terraforte.example'),
  (3, 'Campo Norte Agrícola', 'Sorriso', 'MT', 'Eduardo Ramos', 'eduardo@camponorte.example'),
  (4, 'Planalto Máquinas', 'Passo Fundo', 'RS', 'Carla Mendes', 'carla@planalto.example'),
  (5, 'Oeste Agro Peças', 'Luís Eduardo Magalhães', 'BA', 'Felipe Castro', 'felipe@oesteagro.example'),
  (6, 'Central Máquinas Agrícolas', 'Uberlândia', 'MG', 'Patrícia Alves', 'patricia@centralmaquinas.example');
--> statement-breakpoint
INSERT INTO `proposals` (`id`, `dealership_id`, `contact_name`, `commercial_owner`, `status`, `issue_date`, `valid_until`, `total_cents`, `created_by_email`, `created_by_name`, `created_at`, `updated_at`) VALUES
  ('HBR-20260728-0940-A1F2', 1, 'Ricardo Martins', 'Equipe Comercial HORSCH', 'negotiation', '2026-07-28', '2026-08-27', 15478000, 'demo@horsch.com', 'Dados demonstrativos', '2026-07-28T12:40:00Z', '2026-07-30T16:15:00Z'),
  ('HBR-20260725-1418-B2E4', 2, 'Mariana Lopes', 'Equipe Comercial HORSCH', 'sent', '2026-07-25', '2026-08-24', 8945000, 'demo@horsch.com', 'Dados demonstrativos', '2026-07-25T17:18:00Z', '2026-07-25T17:18:00Z'),
  ('HBR-20260722-1035-C7D1', 3, 'Eduardo Ramos', 'Equipe Comercial HORSCH', 'approved', '2026-07-22', '2026-08-21', 21890000, 'demo@horsch.com', 'Dados demonstrativos', '2026-07-22T13:35:00Z', '2026-07-29T11:20:00Z'),
  ('HBR-20260718-1610-D9A3', 4, 'Carla Mendes', 'Equipe Comercial HORSCH', 'draft', '2026-07-18', '2026-08-17', 4278000, 'demo@horsch.com', 'Dados demonstrativos', '2026-07-18T19:10:00Z', '2026-07-18T19:10:00Z'),
  ('HBR-20260715-0825-E4B8', 5, 'Felipe Castro', 'Equipe Comercial HORSCH', 'approved', '2026-07-15', '2026-08-14', 13620000, 'demo@horsch.com', 'Dados demonstrativos', '2026-07-15T11:25:00Z', '2026-07-23T14:45:00Z'),
  ('HBR-20260710-1542-F6C0', 6, 'Patrícia Alves', 'Equipe Comercial HORSCH', 'rejected', '2026-07-10', '2026-08-09', 6735000, 'demo@horsch.com', 'Dados demonstrativos', '2026-07-10T18:42:00Z', '2026-07-24T10:05:00Z'),
  ('HBR-20260708-1116-G3E7', 1, 'Ricardo Martins', 'Equipe Comercial HORSCH', 'expired', '2026-07-08', '2026-07-23', 2589000, 'demo@horsch.com', 'Dados demonstrativos', '2026-07-08T14:16:00Z', '2026-07-24T09:00:00Z'),
  ('HBR-20260703-1344-H8D5', 3, 'Eduardo Ramos', 'Equipe Comercial HORSCH', 'sent', '2026-07-03', '2026-08-02', 19250000, 'demo@horsch.com', 'Dados demonstrativos', '2026-07-03T16:44:00Z', '2026-07-03T16:44:00Z');
--> statement-breakpoint
INSERT INTO `proposal_items` (`proposal_id`, `part_number`, `description`, `origin`, `ncm`, `quantity`, `unit_price_cents`) VALUES
  ('HBR-20260728-0940-A1F2', '00312345', 'VT8 - Kit de discos', '8', '8432.90.00', 2, 7739000),
  ('HBR-20260725-1418-B2E4', '00458821', 'VT2 - Conjunto de rolamentos', '2', '8482.10.90', 5, 1789000),
  ('HBR-20260722-1035-C7D1', '00274190', 'VT6 - Unidade dosadora', '6', '8432.90.00', 2, 8045000),
  ('HBR-20260722-1035-C7D1', '00512007', 'VT4 - Sensor de fluxo', '4', '9031.80.99', 5, 1160000),
  ('HBR-20260718-1610-D9A3', '00198214', 'VT1 - Kit de vedação', '1', '4016.93.00', 12, 356500),
  ('HBR-20260715-0825-E4B8', '00603211', 'VT7 - Módulo eletrônico', '7', '8537.10.90', 3, 4540000),
  ('HBR-20260710-1542-F6C0', '00377042', 'VT5 - Mancal completo', '5', '8483.20.00', 6, 1122500),
  ('HBR-20260708-1116-G3E7', '00219031', 'VT3 - Mangueira hidráulica', '3', '4009.22.90', 10, 258900),
  ('HBR-20260703-1344-H8D5', '00741550', 'VT9 - Conjunto de braços', '9', '8432.90.00', 2, 7825000),
  ('HBR-20260703-1344-H8D5', '00300514', 'VT2 - Parafuso especial', '2', '7318.15.00', 50, 72000);
