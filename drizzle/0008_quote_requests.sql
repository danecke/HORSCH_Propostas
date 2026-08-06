CREATE TABLE quote_catalog (part_number text PRIMARY KEY NOT NULL, description text DEFAULT '' NOT NULL, vt text DEFAULT '' NOT NULL, origin text DEFAULT '' NOT NULL, net_price_cents integer DEFAULT 0 NOT NULL, imported_at text NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL);
--> statement-breakpoint
CREATE INDEX quote_catalog_imported_idx ON quote_catalog (imported_at);
--> statement-breakpoint
CREATE TABLE quote_requests (id text PRIMARY KEY NOT NULL, part_number text NOT NULL, dealership_id integer NOT NULL, requested_by_email text NOT NULL, requested_by_name text DEFAULT '' NOT NULL, status text DEFAULT 'global_review' NOT NULL, action_owner_role text DEFAULT 'global_management' NOT NULL, action_owner_email text DEFAULT '' NOT NULL, description text DEFAULT '' NOT NULL, vt text DEFAULT '' NOT NULL, origin text DEFAULT '' NOT NULL, net_price_cents integer, catalog_imported_at text, action_note text DEFAULT '' NOT NULL, requested_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, returned_at text, decided_at text, decided_by_email text DEFAULT '' NOT NULL, factory_action_at text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, FOREIGN KEY (dealership_id) REFERENCES dealerships(id));
--> statement-breakpoint
CREATE INDEX quote_requests_dealership_idx ON quote_requests (dealership_id);
--> statement-breakpoint
CREATE INDEX quote_requests_status_idx ON quote_requests (status);
--> statement-breakpoint
CREATE INDEX quote_requests_part_number_idx ON quote_requests (part_number);
--> statement-breakpoint
CREATE INDEX quote_requests_updated_at_idx ON quote_requests (updated_at);
