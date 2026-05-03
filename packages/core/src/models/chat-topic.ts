import type { CoreDB } from '../db'
import type { CoreChatTopic } from '../types/topic'
import type { PromiseResult } from '../utils/result'

import { and, desc, eq, sql } from 'drizzle-orm'

import { accountChatTopicsTable } from '../schemas/account-chat-topics'
import { chatTopicsTable } from '../schemas/chat-topics'
import { withResult } from '../utils/result'

async function recordTopics(
  db: CoreDB,
  topics: CoreChatTopic[],
  platform: 'telegram',
  accountId: string,
): Promise<CoreChatTopic[]> {
  if (topics.length === 0) {
    return []
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(chatTopicsTable)
      .values(topics.map(topic => ({
        platform,
        chat_id: topic.chatId,
        topic_id: topic.topicId,
        title: topic.title,
        icon_color: topic.iconColor,
        icon_emoji_id: topic.iconEmojiId,
        top_message_id: topic.topMessageId,
        last_message_date: topic.lastMessageDate,
        pinned: topic.pinned ?? false,
        closed: topic.closed ?? false,
        hidden: topic.hidden ?? false,
      })))
      .onConflictDoUpdate({
        target: [chatTopicsTable.platform, chatTopicsTable.chat_id, chatTopicsTable.topic_id],
        set: {
          title: sql`excluded.title`,
          icon_color: sql`excluded.icon_color`,
          icon_emoji_id: sql`excluded.icon_emoji_id`,
          top_message_id: sql`excluded.top_message_id`,
          last_message_date: sql`excluded.last_message_date`,
          pinned: sql`excluded.pinned`,
          closed: sql`excluded.closed`,
          hidden: sql`excluded.hidden`,
          updated_at: Date.now(),
        },
      })
      .returning()

    const topicByKey = new Map(topics.map(topic => [`${topic.chatId}:${topic.topicId}`, topic]))

    await tx
      .insert(accountChatTopicsTable)
      .values(rows.map((row) => {
        const topic = topicByKey.get(`${row.chat_id}:${row.topic_id}`)
        return {
          account_id: accountId,
          chat_topic_id: row.id,
          unread_count: topic?.unreadCount ?? 0,
          last_read_inbox_msg_id: topic?.lastReadInboxMsgId,
          last_read_outbox_msg_id: topic?.lastReadOutboxMsgId,
        }
      }))
      .onConflictDoUpdate({
        target: [accountChatTopicsTable.account_id, accountChatTopicsTable.chat_topic_id],
        set: {
          unread_count: sql`excluded.unread_count`,
          last_read_inbox_msg_id: sql`excluded.last_read_inbox_msg_id`,
          last_read_outbox_msg_id: sql`excluded.last_read_outbox_msg_id`,
          updated_at: Date.now(),
        },
      })

    return rows.map((row) => {
      const topic = topicByKey.get(`${row.chat_id}:${row.topic_id}`)
      return {
        chatId: row.chat_id,
        topicId: row.topic_id,
        title: row.title,
        iconColor: row.icon_color ?? undefined,
        iconEmojiId: row.icon_emoji_id ?? undefined,
        topMessageId: row.top_message_id ?? undefined,
        unreadCount: topic?.unreadCount,
        lastReadInboxMsgId: topic?.lastReadInboxMsgId,
        lastReadOutboxMsgId: topic?.lastReadOutboxMsgId,
        lastMessageDate: row.last_message_date ?? undefined,
        pinned: row.pinned,
        closed: row.closed,
        hidden: row.hidden,
      } satisfies CoreChatTopic
    })
  })
}

async function getTopicsByChatId(db: CoreDB, chatId: string, accountId: string): PromiseResult<CoreChatTopic[]> {
  return withResult(async () => {
    const rows = await db
      .select({
        chat_id: chatTopicsTable.chat_id,
        topic_id: chatTopicsTable.topic_id,
        title: chatTopicsTable.title,
        icon_color: chatTopicsTable.icon_color,
        icon_emoji_id: chatTopicsTable.icon_emoji_id,
        top_message_id: chatTopicsTable.top_message_id,
        last_message_date: chatTopicsTable.last_message_date,
        pinned: chatTopicsTable.pinned,
        closed: chatTopicsTable.closed,
        hidden: chatTopicsTable.hidden,
        unread_count: accountChatTopicsTable.unread_count,
        last_read_inbox_msg_id: accountChatTopicsTable.last_read_inbox_msg_id,
        last_read_outbox_msg_id: accountChatTopicsTable.last_read_outbox_msg_id,
      })
      .from(chatTopicsTable)
      .innerJoin(
        accountChatTopicsTable,
        and(
          eq(accountChatTopicsTable.chat_topic_id, chatTopicsTable.id),
          eq(accountChatTopicsTable.account_id, accountId),
        ),
      )
      .where(and(
        eq(chatTopicsTable.platform, 'telegram'),
        eq(chatTopicsTable.chat_id, chatId),
      ))
      .orderBy(desc(chatTopicsTable.pinned), desc(chatTopicsTable.last_message_date))

    return rows.map(row => ({
      chatId: row.chat_id,
      topicId: row.topic_id,
      title: row.title,
      iconColor: row.icon_color ?? undefined,
      iconEmojiId: row.icon_emoji_id ?? undefined,
      topMessageId: row.top_message_id ?? undefined,
      unreadCount: row.unread_count,
      lastReadInboxMsgId: row.last_read_inbox_msg_id ?? undefined,
      lastReadOutboxMsgId: row.last_read_outbox_msg_id ?? undefined,
      lastMessageDate: row.last_message_date ?? undefined,
      pinned: row.pinned,
      closed: row.closed,
      hidden: row.hidden,
    }))
  })
}

async function findTopMessageId(db: CoreDB, chatId: string, topicId: string): PromiseResult<string | undefined> {
  return withResult(async () => {
    const rows = await db
      .select({
        top_message_id: chatTopicsTable.top_message_id,
      })
      .from(chatTopicsTable)
      .where(and(
        eq(chatTopicsTable.platform, 'telegram'),
        eq(chatTopicsTable.chat_id, chatId),
        eq(chatTopicsTable.topic_id, topicId),
      ))
      .limit(1)

    return rows[0]?.top_message_id ?? undefined
  })
}

export const chatTopicModels = {
  recordTopics,
  getTopicsByChatId,
  findTopMessageId,
}

export type ChatTopicModels = typeof chatTopicModels
