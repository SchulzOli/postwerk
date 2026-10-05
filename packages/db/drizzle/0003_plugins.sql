CREATE TYPE "public"."plugin_kind" AS ENUM('theme');--> statement-breakpoint
CREATE TABLE "plugins" (
	"workspace_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"kind" "plugin_kind" NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"manifest" jsonb,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_workspace_id_plugin_id_pk" PRIMARY KEY("workspace_id","plugin_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "theme" text;--> statement-breakpoint
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing workspaces start with the built-in themes installed, like new ones (see @postwerk/core/themes).
INSERT INTO "plugins" ("workspace_id", "plugin_id", "kind", "builtin")
SELECT "workspaces"."id", "builtin"."plugin_id", 'theme', true
FROM "workspaces" CROSS JOIN (VALUES ('aurora'), ('paper'), ('blueprint')) AS "builtin"("plugin_id")
ON CONFLICT DO NOTHING;
