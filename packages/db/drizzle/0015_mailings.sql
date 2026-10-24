CREATE TYPE "public"."letter_status" AS ENUM('queued', 'uploading', 'submitted', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mailing_status" AS ENUM('sending', 'done');--> statement-breakpoint
CREATE TABLE "mailing_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailing_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lines" jsonb NOT NULL,
	"country" text NOT NULL,
	"status" "letter_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"service_id" text,
	"service_status" text,
	"price_cents" integer,
	"price_currency" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"piece_id" uuid NOT NULL,
	"delivery_product" text NOT NULL,
	"color" boolean DEFAULT true NOT NULL,
	"locale" text DEFAULT 'de' NOT NULL,
	"status" "mailing_status" DEFAULT 'sending' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mailing_letters" ADD CONSTRAINT "mailing_letters_mailing_id_mailings_id_fk" FOREIGN KEY ("mailing_id") REFERENCES "public"."mailings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_letters" ADD CONSTRAINT "mailing_letters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailing_letters_mailing_idx" ON "mailing_letters" USING btree ("mailing_id");--> statement-breakpoint
CREATE INDEX "mailing_letters_status_idx" ON "mailing_letters" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "mailings_piece_idx" ON "mailings" USING btree ("piece_id");