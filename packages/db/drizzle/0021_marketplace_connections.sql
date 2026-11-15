CREATE TABLE "marketplace_connections" (
	"workspace_id" uuid NOT NULL,
	"market_id" text NOT NULL,
	"credentials" text,
	"lead_token" text NOT NULL,
	"report_id" text,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_connections_workspace_id_market_id_pk" PRIMARY KEY("workspace_id","market_id")
);
--> statement-breakpoint
CREATE TABLE "marketplace_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"market_id" text NOT NULL,
	"product_id" uuid,
	"action" text DEFAULT '' NOT NULL,
	"offer_title" text DEFAULT '' NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_connections" ADD CONSTRAINT "marketplace_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_leads" ADD CONSTRAINT "marketplace_leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_leads" ADD CONSTRAINT "marketplace_leads_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_connections_token_idx" ON "marketplace_connections" USING btree ("lead_token");--> statement-breakpoint
CREATE INDEX "marketplace_leads_workspace_idx" ON "marketplace_leads" USING btree ("workspace_id","received_at");