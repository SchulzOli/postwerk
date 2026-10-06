CREATE TABLE "bridge_usage" (
	"workspace_id" uuid NOT NULL,
	"bridge" text NOT NULL,
	"month" text NOT NULL,
	"accounts" integer NOT NULL,
	"peak_accounts" integer NOT NULL,
	"profiles" integer NOT NULL,
	"peak_profiles" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_usage_workspace_id_bridge_month_pk" PRIMARY KEY("workspace_id","bridge","month")
);
--> statement-breakpoint
ALTER TABLE "bridge_usage" ADD CONSTRAINT "bridge_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;