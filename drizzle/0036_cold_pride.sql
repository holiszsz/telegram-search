CREATE TABLE "account_chat_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"chat_topic_id" uuid NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_read_inbox_msg_id" text,
	"last_read_outbox_msg_id" text,
	"created_at" bigint DEFAULT 0 NOT NULL,
	"updated_at" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text DEFAULT 'telegram' NOT NULL,
	"chat_id" text DEFAULT '' NOT NULL,
	"topic_id" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"icon_color" integer,
	"icon_emoji_id" text,
	"top_message_id" text,
	"last_message_date" bigint,
	"pinned" boolean DEFAULT false NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" bigint DEFAULT 0 NOT NULL,
	"updated_at" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "topic_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "joined_chats" ADD COLUMN "is_forum" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_chat_topics" ADD CONSTRAINT "account_chat_topics_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_chat_topics" ADD CONSTRAINT "account_chat_topics_chat_topic_id_chat_topics_id_fk" FOREIGN KEY ("chat_topic_id") REFERENCES "public"."chat_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_chat_topics_account_topic_unique_index" ON "account_chat_topics" USING btree ("account_id","chat_topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_topics_platform_chat_id_topic_id_unique_index" ON "chat_topics" USING btree ("platform","chat_id","topic_id");--> statement-breakpoint
CREATE INDEX "chat_messages_in_chat_topic_timestamp_index" ON "chat_messages" USING btree ("in_chat_id","topic_id","platform_timestamp");