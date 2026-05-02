import { bigint, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { accountsTable } from './accounts'
import { chatTopicsTable } from './chat-topics'

export const accountChatTopicsTable = pgTable('account_chat_topics', {
  id: uuid().primaryKey().defaultRandom(),
  account_id: uuid().notNull().references(() => accountsTable.id, { onDelete: 'cascade' }),
  chat_topic_id: uuid().notNull().references(() => chatTopicsTable.id, { onDelete: 'cascade' }),
  unread_count: integer().notNull().default(0),
  last_read_inbox_msg_id: text(),
  last_read_outbox_msg_id: text(),
  created_at: bigint({ mode: 'number' }).notNull().default(0).$defaultFn(() => Date.now()),
  updated_at: bigint({ mode: 'number' }).notNull().default(0).$defaultFn(() => Date.now()),
}, table => [
  uniqueIndex('account_chat_topics_account_topic_unique_index').on(table.account_id, table.chat_topic_id),
])
