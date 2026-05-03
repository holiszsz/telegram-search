import type { CorePagination } from '@tg-search/common'

import type { CoreMessage } from '../../types/message'

// eslint-disable-next-line unicorn/prefer-node-protocol
import { Buffer } from 'buffer'

import { useLogger } from '@guiiai/logg'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { describe, expect, it, vi } from 'vitest'

import { mockDB } from '../../db/mock'
import { accountJoinedChatsTable } from '../../schemas/account-joined-chats'
import { accountsTable } from '../../schemas/accounts'
import { chatMessagesTable } from '../../schemas/chat-messages'
import { joinedChatsTable } from '../../schemas/joined-chats'
import { photosTable } from '../../schemas/photos'
import { usersTable } from '../../schemas/users'
import { chatMessageModels } from '../chat-message'
import { photoModels } from '../photos'

vi.mock('../../utils/jieba', () => ({
  ensureJieba: vi.fn(async () => ({
    cut: (content: string) => [content],
  })),
}))

async function setupDb() {
  return mockDB({
    accountsTable,
    accountJoinedChatsTable,
    joinedChatsTable,
    chatMessagesTable,
    photosTable,
    usersTable,
  })
}

function buildCoreMessage(overrides: Partial<CoreMessage> = {}): CoreMessage {
  return {
    uuid: overrides.uuid ?? 'uuid-1',
    platform: 'telegram',
    platformMessageId: overrides.platformMessageId ?? '1',
    chatId: overrides.chatId ?? 'chat-1',
    fromId: overrides.fromId ?? 'from-1',
    fromName: overrides.fromName ?? 'From 1',
    content: overrides.content ?? 'content',
    topicId: overrides.topicId,
    reply: overrides.reply ?? { isReply: false, replyToId: undefined, replyToName: undefined },
    forward: overrides.forward ?? { isForward: false },
    platformTimestamp: overrides.platformTimestamp ?? Date.now(),
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
    deletedAt: overrides.deletedAt,
    media: overrides.media,
    fromUserUuid: overrides.fromUserUuid,
  }
}

describe('models/chat-message', () => {
  it('recordMessages scopes owner_account_id only for private (user) chats', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [privateChat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'chat-private',
      chat_name: 'Private Chat',
      chat_type: 'user',
    }).returning()

    const [groupChat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'chat-group',
      chat_name: 'Group Chat',
      chat_type: 'group',
    }).returning()

    const messages: CoreMessage[] = [
      buildCoreMessage({
        uuid: uuidv4(),
        platformMessageId: '1',
        chatId: privateChat.chat_id,
        content: 'private message',
      }),
      buildCoreMessage({
        uuid: uuidv4(),
        platformMessageId: '2',
        chatId: groupChat.chat_id,
        content: 'group message',
      }),
    ]

    const result = await chatMessageModels.recordMessages(db, account.id, messages)
    const affectedRows = result
    expect(affectedRows).toHaveLength(2)

    const selectedRows = await db
      .select()
      .from(chatMessagesTable)
      .orderBy(chatMessagesTable.platform_message_id)

    expect(selectedRows).toHaveLength(2)
    const privateRow = selectedRows[0]
    const groupRow = selectedRows[1]

    expect(privateRow.in_chat_type).toBe('user')
    expect(privateRow.owner_account_id).toBe(account.id)

    expect(groupRow.in_chat_type).toBe('group')
    expect(groupRow.owner_account_id).toBeNull()
  })

  it('recordMessages updates topic_id when a resync re-ingests the same Telegram message', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-chat',
      chat_name: 'Forum Chat',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({
        uuid: uuidv4(),
        platformMessageId: '10',
        chatId: chat.chat_id,
        content: 'before topic extraction',
      }),
    ])

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({
        uuid: uuidv4(),
        platformMessageId: '10',
        chatId: chat.chat_id,
        topicId: '777',
        content: 'after topic extraction',
      }),
    ])

    const rows = await db.select().from(chatMessagesTable)

    // Resync must update the recoverable topic metadata in place instead of
    // duplicating the same Telegram message under a different topic_id.
    expect(rows).toHaveLength(1)
    expect(rows[0].topic_id).toBe('777')
    expect(rows[0].content).toBe('after topic extraction')
  })

  it('recordMessages preserves an existing topic_id when a later fetch misses topic metadata', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-chat',
      chat_name: 'Forum Chat',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({
        uuid: uuidv4(),
        platformMessageId: '10',
        chatId: chat.chat_id,
        topicId: '777',
        content: 'with topic metadata',
      }),
    ])

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({
        uuid: uuidv4(),
        platformMessageId: '10',
        chatId: chat.chat_id,
        content: 'without topic metadata',
      }),
    ])

    const rows = await db.select().from(chatMessagesTable)

    // Some Telegram fetch/update shapes omit replyTo topic data; that must not
    // erase a topic_id recovered by an earlier ingestion.
    expect(rows).toHaveLength(1)
    expect(rows[0].topic_id).toBe('777')
    expect(rows[0].content).toBe('without topic metadata')
  })

  it('assignTopicForRootMessages assigns empty root message topics without overwriting existing topics', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-chat',
      chat_name: 'Forum Chat',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '100', chatId: chat.chat_id }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '200', chatId: chat.chat_id, topicId: 'other' }),
    ])

    const count = (await chatMessageModels.assignTopicForRootMessages(db, chat.chat_id, [
      { rootMessageId: '100', topicId: 'topic-a' },
      { rootMessageId: '200', topicId: 'topic-b' },
    ])).unwrap()

    const rows = await db
      .select()
      .from(chatMessagesTable)
      .orderBy(chatMessagesTable.platform_message_id)

    expect(count).toBe(1)
    expect(rows.map(row => [row.platform_message_id, row.topic_id])).toEqual([
      ['100', 'topic-a'],
      ['200', 'other'],
    ])
  })

  it('assignTopicForRootMessages only updates the requested chat', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    await db.insert(joinedChatsTable).values([
      {
        platform: 'telegram',
        chat_id: 'forum-a',
        chat_name: 'Forum A',
        chat_type: 'supergroup',
        is_forum: true,
      },
      {
        platform: 'telegram',
        chat_id: 'forum-b',
        chat_name: 'Forum B',
        chat_type: 'supergroup',
        is_forum: true,
      },
    ])

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '100', chatId: 'forum-a' }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '100', chatId: 'forum-b' }),
    ])

    const count = (await chatMessageModels.assignTopicForRootMessages(db, 'forum-a', [
      { rootMessageId: '100', topicId: 'topic-a' },
    ])).unwrap()

    const rows = await db
      .select()
      .from(chatMessagesTable)
      .orderBy(chatMessagesTable.in_chat_id)

    expect(count).toBe(1)
    expect(rows.map(row => [row.in_chat_id, row.topic_id])).toEqual([
      ['forum-a', 'topic-a'],
      ['forum-b', ''],
    ])
  })

  it('assignTopicForRootMessages accepts an empty assignment list', async () => {
    const db = await setupDb()

    const count = (await chatMessageModels.assignTopicForRootMessages(db, 'forum-a', [])).unwrap()

    expect(count).toBe(0)
  })

  it('fetchMessages enforces ACL and returns messages ordered by platform_timestamp desc', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [otherAccount] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-2',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'chat-1',
      chat_name: 'Private Chat',
      chat_type: 'user',
    }).returning()

    await db.insert(chatMessagesTable).values([
      // Allowed message: owned by account
      {
        platform: 'telegram',
        platform_message_id: '1',
        from_id: 'u1',
        from_name: 'User 1',
        in_chat_id: chat.chat_id,
        in_chat_type: 'user',
        content: 'allowed-1',
        is_reply: false,
        reply_to_name: '',
        reply_to_id: '',
        platform_timestamp: 1000,
        created_at: 1000,
        owner_account_id: account.id,
      },
      // Not allowed: owned by other account
      {
        platform: 'telegram',
        platform_message_id: '2',
        from_id: 'u2',
        from_name: 'User 2',
        in_chat_id: chat.chat_id,
        in_chat_type: 'user',
        content: 'for-other-account',
        is_reply: false,
        reply_to_name: '',
        reply_to_id: '',
        platform_timestamp: 2000,
        created_at: 2000,
        owner_account_id: otherAccount.id,
      },
      // Allowed legacy message: NULL owner
      {
        platform: 'telegram',
        platform_message_id: '3',
        from_id: 'u3',
        from_name: 'User 3',
        in_chat_id: chat.chat_id,
        in_chat_type: 'user',
        content: 'allowed-legacy',
        is_reply: false,
        reply_to_name: '',
        reply_to_id: '',
        platform_timestamp: 3000,
        created_at: 3000,
      },
    ])

    const pagination: CorePagination = { limit: 10, offset: 0 }

    const result = await chatMessageModels.fetchMessages(db, account.id, chat.chat_id, pagination)
    const { dbMessagesResults, coreMessages } = result.unwrap()

    // Should only see 2 messages due to ACL
    expect(dbMessagesResults).toHaveLength(2)
    expect(coreMessages).toHaveLength(2)

    // Ordered by Telegram send time desc => message 3 then message 1.
    expect(dbMessagesResults.map(m => m.platform_message_id)).toEqual(['3', '1'])
  })

  it('softDeleteMessages stores the supplied deletedAt and fetchMessages can include deleted rows', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'chat-1',
      chat_name: 'Private Chat',
      chat_type: 'user',
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '1', chatId: chat.chat_id, content: 'kept', platformTimestamp: 1000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '2', chatId: chat.chat_id, content: 'deleted', platformTimestamp: 2000 }),
    ])

    const deletedAt = 123456789
    // Deletion events must use one server timestamp for both storage and UI payloads.
    const count = await chatMessageModels.softDeleteMessages(db, account.id, ['2'], { chatId: chat.chat_id, deletedAt })

    expect(count).toBe(1)

    const [deletedRow] = await db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.platform_message_id, '2'))
    expect(deletedRow.deleted_at).toBe(deletedAt)

    const visibleByDefault = (await chatMessageModels.fetchMessages(db, account.id, chat.chat_id, { limit: 10, offset: 0 })).unwrap()
    expect(visibleByDefault.dbMessagesResults.map(message => message.platform_message_id)).toEqual(['1'])

    const withDeleted = (await chatMessageModels.fetchMessages(db, account.id, chat.chat_id, { limit: 10, offset: 0 }, { includeDeleted: true })).unwrap()
    expect(withDeleted.coreMessages.map(message => [message.platformMessageId, message.deletedAt])).toEqual([
      ['2', deletedAt],
      ['1', 0],
    ])
  })

  it('fetchMessages orders by Telegram timestamp instead of insertion time', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-chat',
      chat_name: 'Forum Chat',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '1', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 1000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '2', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 2000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '3', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 3000 }),
    ])

    await db.update(chatMessagesTable).set({ created_at: 5000 }).where(eq(chatMessagesTable.platform_message_id, '1'))
    await db.update(chatMessagesTable).set({ created_at: 3000 }).where(eq(chatMessagesTable.platform_message_id, '2'))
    await db.update(chatMessagesTable).set({ created_at: 1000 }).where(eq(chatMessagesTable.platform_message_id, '3'))

    const result = await chatMessageModels.fetchMessages(db, account.id, chat.chat_id, { limit: 10, offset: 0 }, 'alpha')
    const { dbMessagesResults } = result.unwrap()

    // Topic views used to sort by DB insertion time, so backfilled old messages
    // could hide newer Telegram messages at the top of the page.
    expect(dbMessagesResults.map(message => message.platform_message_id)).toEqual(['3', '2', '1'])
  })

  it('fetchMessages uses numeric message id ordering for same-timestamp ties', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-chat',
      chat_name: 'Forum Chat',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '9', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 1000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '10', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 1000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '11', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 1000 }),
    ])

    const result = await chatMessageModels.fetchMessages(db, account.id, chat.chat_id, { limit: 10, offset: 0 }, 'alpha')
    const { dbMessagesResults } = result.unwrap()

    // platform_message_id is stored as text; lexicographic desc would place '9'
    // before '11' and make pagination unstable for messages in the same second.
    expect(dbMessagesResults.map(message => message.platform_message_id)).toEqual(['11', '10', '9'])
  })

  it('fetchMessages filters by topicId when provided', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-chat',
      chat_name: 'Forum Chat',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '1', chatId: chat.chat_id, topicId: 'alpha' }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '2', chatId: chat.chat_id, topicId: 'beta' }),
    ])

    const result = await chatMessageModels.fetchMessages(db, account.id, chat.chat_id, { limit: 10, offset: 0 }, 'alpha')
    const { dbMessagesResults } = result.unwrap()

    expect(dbMessagesResults.map(message => message.platform_message_id)).toEqual(['1'])
  })

  it('fetchMessages treats an empty topicId as the General topic filter', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-chat',
      chat_name: 'Forum Chat',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '1', chatId: chat.chat_id }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '2', chatId: chat.chat_id, topicId: 'alpha' }),
    ])

    const generalResult = await chatMessageModels.fetchMessages(db, account.id, chat.chat_id, { limit: 10, offset: 0 }, '')
    const allResult = await chatMessageModels.fetchMessages(db, account.id, chat.chat_id, { limit: 10, offset: 0 })

    expect(generalResult.unwrap().dbMessagesResults.map(message => message.platform_message_id)).toEqual(['1'])
    expect(allResult.unwrap().dbMessagesResults.map(message => message.platform_message_id)).toEqual(['2', '1'])
  })

  it('fetchMessagesWithPhotos attaches media for each message', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'chat-1',
      chat_name: 'Chat with photos',
      chat_type: 'user',
    }).returning()

    const messageUuid = uuidv4()
    const messages: CoreMessage[] = [
      buildCoreMessage({
        uuid: messageUuid,
        platformMessageId: '1',
        chatId: chat.chat_id,
        content: 'with photo',
        platformTimestamp: 1000,
      }),
    ]

    await chatMessageModels.recordMessages(db, account.id, messages)

    const [dbMessage] = await db.select().from(chatMessagesTable)

    await db.insert(photosTable).values({
      platform: 'telegram',
      file_id: 'file-1',
      message_id: dbMessage.id,
      image_bytes: Buffer.from([1, 2, 3]),
      image_mime_type: 'image/jpeg',
    })

    const pagination: CorePagination = { limit: 10, offset: 0 }

    const result = await chatMessageModels.fetchMessagesWithPhotos(db, photoModels, account.id, chat.chat_id, pagination)
    const messagesWithPhotos = result.unwrap()

    expect(messagesWithPhotos).toHaveLength(1)
    const [message] = messagesWithPhotos
    expect(message.media).toBeDefined()
    expect(message.media?.length).toBe(1)
    expect(message.media?.[0].type).toBe('photo')

    // DO NOT USE messageUUID for photos, it's not the message UUID
    expect(message.media?.[0].messageUUID).not.toEqual(messageUuid)
  })

  it('fetchMessageContextWithPhotos returns surrounding messages with media attached', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'chat-ctx',
      chat_name: 'Context Chat',
      chat_type: 'user',
    }).returning()

    const coreMessages: CoreMessage[] = [
      buildCoreMessage({
        uuid: uuidv4(),
        platformMessageId: '1',
        chatId: chat.chat_id,
        content: 'before',
        platformTimestamp: 1000,
      }),
      buildCoreMessage({
        uuid: uuidv4(),
        platformMessageId: '2',
        chatId: chat.chat_id,
        content: 'target',
        platformTimestamp: 2000,
      }),
      buildCoreMessage({
        uuid: uuidv4(),
        platformMessageId: '3',
        chatId: chat.chat_id,
        content: 'after',
        platformTimestamp: 3000,
      }),
    ]

    await chatMessageModels.recordMessages(db, account.id, coreMessages)

    const dbMessages = await db
      .select()
      .from(chatMessagesTable)
      .orderBy(chatMessagesTable.platform_message_id)

    // Attach one photo per message
    for (const dbMessage of dbMessages) {
      await db.insert(photosTable).values({
        platform: 'telegram',
        file_id: `file-${dbMessage.platform_message_id}`,
        message_id: dbMessage.id,
        image_bytes: Buffer.from([1]),
        image_mime_type: 'image/jpeg',
      })
    }

    const context = (await chatMessageModels.fetchMessageContextWithPhotos(db, photoModels, account.id, {
      chatId: chat.chat_id,
      messageId: '2',
      before: 1,
      after: 1,
    })).unwrap()

    expect(context.map(m => m.platformMessageId)).toEqual(['1', '2', '3'])
    context.forEach((message) => {
      expect(message.media).toBeDefined()
      expect(message.media?.length).toBe(1)
      expect(message.media?.[0].type).toBe('photo')
    })
  })

  it('fetchMessageContextWithPhotos filters surrounding messages by topicId', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-ctx',
      chat_name: 'Forum Context Chat',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '1', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 1000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '2', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 2000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '3', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 3000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '4', chatId: chat.chat_id, topicId: 'beta', platformTimestamp: 1500 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '5', chatId: chat.chat_id, topicId: 'beta', platformTimestamp: 2500 }),
    ])

    const context = (await chatMessageModels.fetchMessageContextWithPhotos(db, photoModels, account.id, {
      chatId: chat.chat_id,
      messageId: '2',
      topicId: 'alpha',
      before: 2,
      after: 2,
    })).unwrap()

    // Topic-filtered search context used to include chronologically adjacent
    // messages from other topics.
    expect(context.map(m => m.platformMessageId)).toEqual(['1', '2', '3'])
    expect(context.every(message => message.topicId === 'alpha')).toBe(true)
  })

  it('fetchMessageContextWithPhotos treats an empty topicId as the General topic filter', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-ctx',
      chat_name: 'Forum Context Chat',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await chatMessageModels.recordMessages(db, account.id, [
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '1', chatId: chat.chat_id, platformTimestamp: 1000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '2', chatId: chat.chat_id, platformTimestamp: 2000 }),
      buildCoreMessage({ uuid: uuidv4(), platformMessageId: '3', chatId: chat.chat_id, topicId: 'alpha', platformTimestamp: 1500 }),
    ])

    const context = (await chatMessageModels.fetchMessageContextWithPhotos(db, photoModels, account.id, {
      chatId: chat.chat_id,
      messageId: '2',
      topicId: '',
      before: 2,
      after: 2,
    })).unwrap()

    expect(context.map(m => m.platformMessageId)).toEqual(['1', '2'])
    expect(context.every(message => message.topicId === undefined)).toBe(true)
  })

  it('retrieveMessages applies the General topic filter to jieba retrieval', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-search',
      chat_name: 'Forum Search',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await db.insert(accountJoinedChatsTable).values({
      account_id: account.id,
      joined_chat_id: chat.id,
    })

    await db.insert(chatMessagesTable).values([
      {
        platform: 'telegram',
        platform_message_id: '1',
        from_id: 'u1',
        from_name: 'User 1',
        in_chat_id: chat.chat_id,
        in_chat_type: 'supergroup',
        content: '苹果 general',
        is_reply: false,
        reply_to_name: '',
        reply_to_id: '',
        platform_timestamp: 1000,
        created_at: 1000,
        jieba_tokens: ['苹果'],
      },
      {
        platform: 'telegram',
        platform_message_id: '2',
        from_id: 'u1',
        from_name: 'User 1',
        in_chat_id: chat.chat_id,
        in_chat_type: 'supergroup',
        topic_id: 'alpha',
        content: '苹果 topic',
        is_reply: false,
        reply_to_name: '',
        reply_to_id: '',
        platform_timestamp: 2000,
        created_at: 2000,
        jieba_tokens: ['苹果'],
      },
    ])

    const results = (await chatMessageModels.retrieveMessages(
      db,
      useLogger('models:chat-message:test'),
      account.id,
      768,
      { text: '苹果' },
      { limit: 10, offset: 0 },
      { chatIds: [chat.chat_id], topicId: '' },
    )).unwrap()

    expect(results.map(message => message.platform_message_id)).toEqual(['1'])
  })

  it('retrieveMessages applies the General topic filter to vector retrieval', async () => {
    const db = await setupDb()

    const [account] = await db.insert(accountsTable).values({
      platform: 'telegram',
      platform_user_id: 'user-1',
    }).returning()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-vector',
      chat_name: 'Forum Vector',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    await db.insert(accountJoinedChatsTable).values({
      account_id: account.id,
      joined_chat_id: chat.id,
    })

    const vector = [1, ...Array.from({ length: 767 }, () => 0)]
    await db.insert(chatMessagesTable).values([
      {
        platform: 'telegram',
        platform_message_id: '1',
        from_id: 'u1',
        from_name: 'User 1',
        in_chat_id: chat.chat_id,
        in_chat_type: 'supergroup',
        content: 'general vector',
        is_reply: false,
        reply_to_name: '',
        reply_to_id: '',
        platform_timestamp: 1000,
        created_at: 1000,
        content_vector_model: 'test-model',
        content_vector_768: vector,
      },
      {
        platform: 'telegram',
        platform_message_id: '2',
        from_id: 'u1',
        from_name: 'User 1',
        in_chat_id: chat.chat_id,
        in_chat_type: 'supergroup',
        topic_id: 'alpha',
        content: 'topic vector',
        is_reply: false,
        reply_to_name: '',
        reply_to_id: '',
        platform_timestamp: 2000,
        created_at: 2000,
        content_vector_model: 'test-model',
        content_vector_768: vector,
      },
    ])

    const results = (await chatMessageModels.retrieveMessages(
      db,
      useLogger('models:chat-message:test'),
      account.id,
      768,
      { model: 'test-model', embedding: vector },
      { limit: 10, offset: 0 },
      { chatIds: [chat.chat_id], topicId: '' },
    )).unwrap()

    expect(results.map(message => message.platform_message_id)).toEqual(['1'])
  })
})
