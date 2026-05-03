import { describe, expect, it } from 'vitest'

import { mockDB } from '../../db/mock'
import { accountChatTopicsTable } from '../../schemas/account-chat-topics'
import { accountsTable } from '../../schemas/accounts'
import { chatTopicsTable } from '../../schemas/chat-topics'
import { chatTopicModels } from '../chat-topic'

async function setupDb() {
  return mockDB({
    accountsTable,
    chatTopicsTable,
    accountChatTopicsTable,
  })
}

describe('models/chat-topic', () => {
  it('recordTopics upserts global metadata and account state separately', async () => {
    const db = await setupDb()
    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    await chatTopicModels.recordTopics(db, [{
      chatId: 'chat-1',
      topicId: 'topic-1',
      title: 'Initial title',
      unreadCount: 1,
      lastReadInboxMsgId: '10',
    }], 'telegram', account.id)

    await chatTopicModels.recordTopics(db, [{
      chatId: 'chat-1',
      topicId: 'topic-1',
      title: 'Updated title',
      unreadCount: 5,
      lastReadInboxMsgId: '20',
    }], 'telegram', account.id)

    const globalRows = await db.select().from(chatTopicsTable)
    const accountRows = await db.select().from(accountChatTopicsTable)
    const topics = (await chatTopicModels.getTopicsByChatId(db, 'chat-1', account.id)).unwrap()

    expect(globalRows).toHaveLength(1)
    expect(globalRows[0].title).toBe('Updated title')
    expect(accountRows).toHaveLength(1)
    expect(accountRows[0].unread_count).toBe(5)
    expect(accountRows[0].last_read_inbox_msg_id).toBe('20')
    expect(topics[0].unreadCount).toBe(5)
  })

  it('findTopMessageId resolves the Telegram topic root message id', async () => {
    const db = await setupDb()
    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    await chatTopicModels.recordTopics(db, [{
      chatId: 'chat-1',
      topicId: 'topic-1',
      topMessageId: '777',
      title: 'Topic title',
    }], 'telegram', account.id)

    const topMessageId = (await chatTopicModels.findTopMessageId(db, 'chat-1', 'topic-1')).unwrap()
    const missingTopMessageId = (await chatTopicModels.findTopMessageId(db, 'chat-1', 'missing-topic')).unwrap()

    expect(topMessageId).toBe('777')
    expect(missingTopMessageId).toBeUndefined()
  })
})
