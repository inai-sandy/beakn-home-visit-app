CREATE TABLE "rate_limit_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"key" text NOT NULL,
	"ip_address" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_attempts_key_attempted_at_idx" ON "rate_limit_attempts" USING btree ("key","attempted_at");