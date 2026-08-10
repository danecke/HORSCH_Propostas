ALTER TABLE quote_requests ADD COLUMN target_net_price_cents integer;
--> statement-breakpoint
ALTER TABLE quote_requests ADD COLUMN request_observation text DEFAULT '' NOT NULL;
