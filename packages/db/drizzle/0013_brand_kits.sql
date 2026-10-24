CREATE TABLE "brand_kits" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"tone" text DEFAULT '' NOT NULL,
	"dos" text DEFAULT '' NOT NULL,
	"donts" text DEFAULT '' NOT NULL,
	"colors" jsonb NOT NULL,
	"font" text DEFAULT 'sans' NOT NULL,
	"logo_media_id" uuid,
	"website" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"character" jsonb,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_logo_media_id_media_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;