ALTER TYPE "public"."provider" ADD VALUE 'facebook' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'instagram' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'threads' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'linkedin' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'linkedin_page' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'x' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'tiktok' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'youtube' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'pinterest' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'reddit' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'google_business' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'telegram' BEFORE 'sandbox';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'discord' BEFORE 'sandbox';--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "media" jsonb DEFAULT '[]'::jsonb NOT NULL;