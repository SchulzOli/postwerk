CREATE TYPE "public"."ad_launch_status" AS ENUM('paused', 'running', 'ended');--> statement-breakpoint
CREATE TYPE "public"."ad_platform" AS ENUM('google_ads', 'meta_ads');--> statement-breakpoint
CREATE TABLE "ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" "ad_platform" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"time_zone" text,
	"test" boolean DEFAULT false NOT NULL,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credentials_enc" text NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"piece_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"status" "ad_launch_status" DEFAULT 'paused' NOT NULL,
	"budget_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"countries" jsonb NOT NULL,
	"error" text,
	"synced_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_launches" ADD CONSTRAINT "ad_launches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_launches" ADD CONSTRAINT "ad_launches_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_launches" ADD CONSTRAINT "ad_launches_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_launches" ADD CONSTRAINT "ad_launches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_external_idx" ON "ad_accounts" USING btree ("workspace_id","platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_launches_piece_idx" ON "ad_launches" USING btree ("piece_id");