CREATE TABLE "bridge_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bridge" text NOT NULL,
	"profile_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "bridge" text;--> statement-breakpoint
ALTER TABLE "bridge_profiles" ADD CONSTRAINT "bridge_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_profiles_bridge_profile_idx" ON "bridge_profiles" USING btree ("bridge","profile_id");--> statement-breakpoint
CREATE INDEX "bridge_profiles_workspace_idx" ON "bridge_profiles" USING btree ("workspace_id","bridge");