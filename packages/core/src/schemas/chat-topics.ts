import { bigint, boolean, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const chatTopicsTable = pgTable('chat_topics', {
  id: uuid().primaryKey().defaultRandom(),
  platform: text().notNull().default('telegram'),
  chat_id: text().notNull().default(''),
  topic_id: text().notNull().default(''),
  title: text().notNull().default(''),
  icon_color: integer(),
  icon_emoji_id: text(),
  top_message_id: text(),
  last_message_date: bigint({ mode: 'number' }),
  pinned: boolean().notNull().default(false),
  closed: boolean().notNull().default(false),
  hidden: boolean().notNull().default(false),
  created_at: bigint({ mode: 'number' }).notNull().default(0).$defaultFn(() => Date.now()),
  updated_at: bigint({ mode: 'number' }).notNull().default(0).$defaultFn(() => Date.now()),
}, table => [
  uniqueIndex('chat_topics_platform_chat_id_topic_id_unique_index').on(table.platform, table.chat_id, table.topic_id),
])
