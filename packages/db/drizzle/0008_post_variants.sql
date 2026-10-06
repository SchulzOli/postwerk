ALTER TABLE "post_targets" ADD COLUMN "delay_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "variants" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Targets that have not been tried yet still carry their flow delay in next_attempt_at; keep it when posts are rescheduled.
UPDATE "post_targets" SET "delay_minutes" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM ("post_targets"."next_attempt_at" - "posts"."scheduled_at")) / 60))
FROM "posts"
WHERE "posts"."id" = "post_targets"."post_id" AND "post_targets"."status" = 'pending' AND "post_targets"."attempts" = 0 AND "posts"."scheduled_at" IS NOT NULL;
