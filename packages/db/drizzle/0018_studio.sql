CREATE TABLE "studio_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"formats" jsonb NOT NULL,
	"variants" integer NOT NULL,
	"language" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"piece_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_ideas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_runs" ADD CONSTRAINT "studio_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_runs" ADD CONSTRAINT "studio_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_runs" ADD CONSTRAINT "studio_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_runs_workspace_idx" ON "studio_runs" USING btree ("workspace_id","created_at");