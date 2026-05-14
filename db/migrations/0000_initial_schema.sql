-- uuid_generate_v7(): generates a UUID version 7 (sortable, time-ordered).
-- Postgres 16 ships gen_random_uuid() (v4) only; v7 needs a custom function.
-- Canonical implementation: overlay timestamp into upper 48 bits, then flip version bits.
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
BEGIN
  RETURN encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
                from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('sales_executive', 'captain', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."bhk_type" AS ENUM('1BHK', '2BHK', '3BHK', '4BHK', 'Others');--> statement-breakpoint
CREATE TYPE "public"."cancellation_actor" AS ENUM('customer', 'exec', 'captain', 'admin');--> statement-breakpoint
CREATE TYPE "public"."lead_type" AS ENUM('Customer', 'Business');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'completed', 'postponed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('Outlet visit', 'Customer home visit', 'Sales pitch', 'Follow-up', 'Installation & Activation', 'Stall Activity', 'Other');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('Cash', 'UPI', 'Bank Transfer', 'Cheque');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push', 'whatsapp', 'email', 'discord');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'retrying');--> statement-breakpoint
CREATE TABLE "admin_help_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"request_id" uuid NOT NULL,
	"exec_user_id" uuid NOT NULL,
	"message" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replied_message" text,
	"replied_at" timestamp with time zone,
	"replied_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "user_role",
	"target_entity_type" varchar(64) NOT NULL,
	"target_entity_id" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"role" "user_role" NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"phone" varchar(15) NOT NULL,
	"email" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"category" varchar(32) NOT NULL,
	"description" text,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"applies_to_city_ids" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captains" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"is_unavailable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" varchar(100) NOT NULL,
	"state" varchar(100),
	"captain_user_id" uuid,
	"discord_webhook_url" text,
	"captain_routing_email" varchar(255),
	"other_routing_email" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sales_executives" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"captain_user_id" uuid NOT NULL,
	"is_unavailable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_reschedule_history" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"request_id" uuid NOT NULL,
	"from_visit_scheduled_at" timestamp with time zone,
	"to_visit_scheduled_at" timestamp with time zone NOT NULL,
	"rescheduled_by_user_id" uuid,
	"reason" text,
	"rescheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_status_history" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"request_id" uuid NOT NULL,
	"from_status_stage_id" uuid,
	"to_status_stage_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"changed_by_user_id" uuid,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_stages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"sequence_number" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"customer_phone" varchar(15) NOT NULL,
	"customer_email" varchar(255),
	"address" text NOT NULL,
	"city_id" uuid NOT NULL,
	"bhk" "bhk_type" NOT NULL,
	"interest" jsonb NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"tracking_token" varchar(32) NOT NULL,
	"source" varchar(32) DEFAULT 'web' NOT NULL,
	"status_stage_id" uuid NOT NULL,
	"assigned_exec_user_id" uuid,
	"assigned_captain_user_id" uuid,
	"assigned_at" timestamp with time zone,
	"visit_scheduled_at" timestamp with time zone,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_actor" "cancellation_actor",
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_types" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"sequence_number" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"type" "lead_type" NOT NULL,
	"name" varchar(255) NOT NULL,
	"firm_name" varchar(255),
	"business_type_id" uuid,
	"bhk" "bhk_type",
	"phone" varchar(15) NOT NULL,
	"email" varchar(255),
	"city_id" uuid NOT NULL,
	"interest" jsonb NOT NULL,
	"notes" text,
	"captured_by_user_id" uuid NOT NULL,
	"captured_date" date DEFAULT now() NOT NULL,
	"converted_to_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"exec_user_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_visit_count" integer DEFAULT 0 NOT NULL,
	"additional_task_count" integer DEFAULT 0 NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"amount_collected_paise" bigint,
	"quotations_submitted_today" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_options" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"task_type" "task_type" NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"sequence_number" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postpone_reasons" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"sequence_number" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"exec_user_id" uuid NOT NULL,
	"day_plan_id" uuid,
	"task_type" "task_type" NOT NULL,
	"description" text NOT NULL,
	"estimated_time" varchar(32) NOT NULL,
	"task_date" date NOT NULL,
	"link_request_id" uuid,
	"link_lead_id" uuid,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"outcome_option_id" uuid,
	"outcome_notes" text,
	"actual_time" varchar(32),
	"completed_at" timestamp with time zone,
	"postponed_to_date" date,
	"postpone_reason_id" uuid,
	"customer_informed" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"visit_request_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"payment_date" date NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"reference_number" text NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"visit_request_id" uuid NOT NULL,
	"quotation_number" varchar(100) NOT NULL,
	"total_order_value_paise" bigint NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_app_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications_queue" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"recipient_user_id" uuid,
	"recipient_address" text,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_help_messages" ADD CONSTRAINT "admin_help_messages_request_id_visit_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."visit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_help_messages" ADD CONSTRAINT "admin_help_messages_exec_user_id_users_id_fk" FOREIGN KEY ("exec_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_help_messages" ADD CONSTRAINT "admin_help_messages_replied_by_admin_id_users_id_fk" FOREIGN KEY ("replied_by_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config" ADD CONSTRAINT "config_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captains" ADD CONSTRAINT "captains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_captain_user_id_users_id_fk" FOREIGN KEY ("captain_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_executives" ADD CONSTRAINT "sales_executives_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_executives" ADD CONSTRAINT "sales_executives_captain_user_id_users_id_fk" FOREIGN KEY ("captain_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_reschedule_history" ADD CONSTRAINT "request_reschedule_history_request_id_visit_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."visit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_reschedule_history" ADD CONSTRAINT "request_reschedule_history_rescheduled_by_user_id_users_id_fk" FOREIGN KEY ("rescheduled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_request_id_visit_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."visit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_from_status_stage_id_status_stages_id_fk" FOREIGN KEY ("from_status_stage_id") REFERENCES "public"."status_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_to_status_stage_id_status_stages_id_fk" FOREIGN KEY ("to_status_stage_id") REFERENCES "public"."status_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_status_stage_id_status_stages_id_fk" FOREIGN KEY ("status_stage_id") REFERENCES "public"."status_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_assigned_exec_user_id_users_id_fk" FOREIGN KEY ("assigned_exec_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_assigned_captain_user_id_users_id_fk" FOREIGN KEY ("assigned_captain_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_requests" ADD CONSTRAINT "visit_requests_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_type_id_business_types_id_fk" FOREIGN KEY ("business_type_id") REFERENCES "public"."business_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_captured_by_user_id_users_id_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_to_request_id_visit_requests_id_fk" FOREIGN KEY ("converted_to_request_id") REFERENCES "public"."visit_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_plans" ADD CONSTRAINT "day_plans_exec_user_id_users_id_fk" FOREIGN KEY ("exec_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_exec_user_id_users_id_fk" FOREIGN KEY ("exec_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_day_plan_id_day_plans_id_fk" FOREIGN KEY ("day_plan_id") REFERENCES "public"."day_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_link_request_id_visit_requests_id_fk" FOREIGN KEY ("link_request_id") REFERENCES "public"."visit_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_link_lead_id_leads_id_fk" FOREIGN KEY ("link_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_outcome_option_id_outcome_options_id_fk" FOREIGN KEY ("outcome_option_id") REFERENCES "public"."outcome_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_postpone_reason_id_postpone_reasons_id_fk" FOREIGN KEY ("postpone_reason_id") REFERENCES "public"."postpone_reasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_visit_request_id_visit_requests_id_fk" FOREIGN KEY ("visit_request_id") REFERENCES "public"."visit_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_visit_request_id_visit_requests_id_fk" FOREIGN KEY ("visit_request_id") REFERENCES "public"."visit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_queue" ADD CONSTRAINT "notifications_queue_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_help_messages_request_idx" ON "admin_help_messages" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "admin_help_messages_exec_idx" ON "admin_help_messages" USING btree ("exec_user_id");--> statement-breakpoint
CREATE INDEX "admin_help_messages_sent_at_idx" ON "admin_help_messages" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "admin_help_messages_pending_reply_idx" ON "admin_help_messages" USING btree ("replied_at");--> statement-breakpoint
CREATE INDEX "audit_log_event_type_idx" ON "audit_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_entity_type","target_entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "config_category_idx" ON "config" USING btree ("category");--> statement-breakpoint
CREATE INDEX "holidays_start_date_idx" ON "holidays" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "holidays_end_date_idx" ON "holidays" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "holidays_is_active_idx" ON "holidays" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "cities_captain_user_idx" ON "cities" USING btree ("captain_user_id");--> statement-breakpoint
CREATE INDEX "sales_executives_captain_user_idx" ON "sales_executives" USING btree ("captain_user_id");--> statement-breakpoint
CREATE INDEX "request_reschedule_history_request_idx" ON "request_reschedule_history" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_reschedule_history_rescheduled_at_idx" ON "request_reschedule_history" USING btree ("rescheduled_at");--> statement-breakpoint
CREATE INDEX "request_status_history_request_idx" ON "request_status_history" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_status_history_changed_at_idx" ON "request_status_history" USING btree ("changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "request_status_history_request_sequence_unique" ON "request_status_history" USING btree ("request_id","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "status_stages_code_unique" ON "status_stages" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "status_stages_sequence_unique" ON "status_stages" USING btree ("sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_requests_tracking_token_unique" ON "visit_requests" USING btree ("tracking_token");--> statement-breakpoint
CREATE INDEX "visit_requests_city_idx" ON "visit_requests" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "visit_requests_status_idx" ON "visit_requests" USING btree ("status_stage_id");--> statement-breakpoint
CREATE INDEX "visit_requests_assigned_exec_idx" ON "visit_requests" USING btree ("assigned_exec_user_id");--> statement-breakpoint
CREATE INDEX "visit_requests_assigned_captain_idx" ON "visit_requests" USING btree ("assigned_captain_user_id");--> statement-breakpoint
CREATE INDEX "visit_requests_phone_idx" ON "visit_requests" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "visit_requests_created_idx" ON "visit_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "visit_requests_visit_scheduled_idx" ON "visit_requests" USING btree ("visit_scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_types_code_unique" ON "business_types" USING btree ("code");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "leads_city_idx" ON "leads" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "leads_captured_by_idx" ON "leads" USING btree ("captured_by_user_id");--> statement-breakpoint
CREATE INDEX "leads_captured_date_idx" ON "leads" USING btree ("captured_date");--> statement-breakpoint
CREATE INDEX "leads_type_idx" ON "leads" USING btree ("type");--> statement-breakpoint
CREATE INDEX "leads_business_type_idx" ON "leads" USING btree ("business_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "day_plans_exec_date_unique" ON "day_plans" USING btree ("exec_user_id","plan_date");--> statement-breakpoint
CREATE INDEX "day_plans_exec_idx" ON "day_plans" USING btree ("exec_user_id");--> statement-breakpoint
CREATE INDEX "day_plans_date_idx" ON "day_plans" USING btree ("plan_date");--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_options_task_type_code_unique" ON "outcome_options" USING btree ("task_type","code");--> statement-breakpoint
CREATE INDEX "outcome_options_task_type_idx" ON "outcome_options" USING btree ("task_type");--> statement-breakpoint
CREATE UNIQUE INDEX "postpone_reasons_code_unique" ON "postpone_reasons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "tasks_exec_idx" ON "tasks" USING btree ("exec_user_id");--> statement-breakpoint
CREATE INDEX "tasks_day_plan_idx" ON "tasks" USING btree ("day_plan_id");--> statement-breakpoint
CREATE INDEX "tasks_task_date_idx" ON "tasks" USING btree ("task_date");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_link_request_idx" ON "tasks" USING btree ("link_request_id");--> statement-breakpoint
CREATE INDEX "tasks_link_lead_idx" ON "tasks" USING btree ("link_lead_id");--> statement-breakpoint
CREATE INDEX "payments_visit_request_idx" ON "payments" USING btree ("visit_request_id");--> statement-breakpoint
CREATE INDEX "payments_payment_date_idx" ON "payments" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX "payments_recorded_by_idx" ON "payments" USING btree ("recorded_by_user_id");--> statement-breakpoint
CREATE INDEX "payments_mode_idx" ON "payments" USING btree ("mode");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_visit_request_unique" ON "quotations" USING btree ("visit_request_id");--> statement-breakpoint
CREATE INDEX "quotations_submitted_by_idx" ON "quotations" USING btree ("submitted_by_user_id");--> statement-breakpoint
CREATE INDEX "in_app_notifications_user_idx" ON "in_app_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "in_app_notifications_user_read_idx" ON "in_app_notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "in_app_notifications_created_idx" ON "in_app_notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_queue_status_idx" ON "notifications_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_queue_scheduled_idx" ON "notifications_queue" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "notifications_queue_recipient_user_idx" ON "notifications_queue" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notifications_queue_event_type_idx" ON "notifications_queue" USING btree ("event_type");