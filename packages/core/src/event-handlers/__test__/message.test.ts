import type { Models } from '../../models'

import bigInt from 'big-integer'

import { useLogger } from '@guiiai/logg'
import { Api } from 'telegram'
import { describe, expect, it, vi } from 'vitest'

import { getMockEmptyDB } from '../../../mock'
import { createCoreContext } from '../../context'
import { CoreEventType } from '../../types/events'
import { registerMessageEventHandlers } from '../message'

const models = {} as unknown as Models
const logger = useLogger()

describe('message event handlers', () => {
  it('message:reprocess should fetch messages and emit message:process with forceRefetch', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)

    // Mock message service
    const mockMessages = [
      new Api.Message({
        id: 123,
        peerId: new Api.PeerUser({ userId: bigInt(456) }),
        message: 'Test message',
        date: Math.floor(Date.now() / 1000),
      }),
    ]

    const mockMessageService = {
      fetchSpecificMessages: vi.fn(async (_chatId: string, _messageIds: number[]) => {
        return mockMessages
      }),
    }

    // Register handlers
    const registerHandlers = registerMessageEventHandlers(ctx, logger)
    registerHandlers(mockMessageService as any)

    // Set up listener for message:process to capture forceRefetch flag
    let capturedForceRefetch: boolean | undefined
    ctx.emitter.on(CoreEventType.MessageProcess, ({ forceRefetch }) => {
      capturedForceRefetch = forceRefetch
    })

    // Emit message:reprocess event
    ctx.emitter.emit(CoreEventType.MessageReprocess, {
      chatId: '789',
      messageIds: [123],
      resolvers: ['media'],
    })

    // Wait for async handlers to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify forceRefetch flag is set to true
    expect(mockMessageService.fetchSpecificMessages).toHaveBeenCalledWith('789', [123])
    expect(capturedForceRefetch).toBe(true)
  })

  it('message:reprocess should handle fetch errors gracefully', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)

    // Mock message service that throws error
    const mockMessageService = {
      fetchSpecificMessages: vi.fn(async () => {
        throw new Error('Failed to fetch messages')
      }),
    }

    // Register handlers
    const registerHandlers = registerMessageEventHandlers(ctx, logger)
    registerHandlers(mockMessageService as any)

    // Set up listener for core:error
    const errors: any[] = []
    ctx.emitter.on(CoreEventType.CoreError, (error) => {
      errors.push(error)
    })

    // Emit message:reprocess event
    ctx.emitter.emit(CoreEventType.MessageReprocess, {
      chatId: '789',
      messageIds: [123],
      resolvers: ['media'],
    })

    // Wait for async handlers to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify error was emitted
    expect(mockMessageService.fetchSpecificMessages).toHaveBeenCalledWith('789', [123])
    expect(errors).toHaveLength(1)
    expect(errors[0].description).toBe('Failed to re-process messages')
  })

  it('message:reprocess should not emit message:process if no messages found', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)

    // Mock message service that returns empty array
    const mockMessageService = {
      fetchSpecificMessages: vi.fn(async () => {
        return []
      }),
    }

    // Register handlers
    const registerHandlers = registerMessageEventHandlers(ctx, logger)
    registerHandlers(mockMessageService as any)

    // Set up listener for message:process
    const processedMessages: Api.Message[] = []
    ctx.emitter.on(CoreEventType.MessageProcess, ({ messages }) => {
      processedMessages.push(...messages)
    })

    // Emit message:reprocess event
    ctx.emitter.emit(CoreEventType.MessageReprocess, {
      chatId: '789',
      messageIds: [123],
      resolvers: ['media'],
    })

    // Wait for async handlers to complete
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify no messages were processed
    expect(mockMessageService.fetchSpecificMessages).toHaveBeenCalledWith('789', [123])
    expect(processedMessages).toHaveLength(0)
  })

  it('message:fetch:topic resolves topMessageId and emits message:process', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)
    ctx.setCurrentAccountId('account-1')

    const mockMessages = [
      new Api.Message({
        id: 123,
        peerId: new Api.PeerChannel({ channelId: bigInt(456) }),
        message: 'Topic message',
        date: Math.floor(Date.now() / 1000),
      }),
    ]

    async function* fetchTopicMessages() {
      yield* mockMessages
    }

    const dbModels = {
      chatModels: {
        isChatAccessibleByAccount: vi.fn(async () => ({ expect: () => true })),
        findChatAccessHash: vi.fn(),
      },
      chatTopicModels: {
        findTopMessageId: vi.fn(async () => ({ expect: () => '777' })),
        recordTopics: vi.fn(),
      },
    } as unknown as Models

    const mockMessageService = {
      fetchTopicMessages: vi.fn(() => fetchTopicMessages()),
    }

    registerMessageEventHandlers(ctx, logger, dbModels)(mockMessageService as any)

    const processedMessages: Api.Message[] = []
    ctx.emitter.on(CoreEventType.MessageProcess, ({ messages }) => {
      processedMessages.push(...messages)
    })

    ctx.emitter.emit(CoreEventType.MessageFetchTopic, {
      chatId: '456',
      topicId: 'topic-1',
      pagination: { offset: 0, limit: 20 },
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(dbModels.chatTopicModels.findTopMessageId).toHaveBeenCalledWith(ctx.getDB(), '456', 'topic-1')
    expect(mockMessageService.fetchTopicMessages).toHaveBeenCalledWith('456', '777', expect.objectContaining({
      chatId: '456',
      topicId: 'topic-1',
      pagination: { offset: 0, limit: 20 },
    }))
    expect(processedMessages).toEqual(mockMessages)
  })

  it('message:fetch:topic falls back to storage when topic metadata is unavailable', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)
    ctx.setCurrentAccountId('account-1')

    const dbModels = {
      chatModels: {
        isChatAccessibleByAccount: vi.fn(async () => ({ expect: () => true })),
        findChatAccessHash: vi.fn(),
      },
      chatTopicModels: {
        findTopMessageId: vi.fn(async () => ({ expect: () => undefined })),
        recordTopics: vi.fn(),
      },
    } as unknown as Models

    const mockMessageService = {
      fetchTopicMessages: vi.fn(),
    }

    registerMessageEventHandlers(ctx, logger, dbModels)(mockMessageService as any)

    const storageRequests: any[] = []
    ctx.emitter.on(CoreEventType.StorageFetchMessages, (data) => {
      storageRequests.push(data)
    })

    ctx.emitter.emit(CoreEventType.MessageFetchTopic, {
      chatId: '456',
      topicId: 'topic-1',
      pagination: { offset: 20, limit: 20 },
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(mockMessageService.fetchTopicMessages).not.toHaveBeenCalled()
    expect(storageRequests).toEqual([{
      chatId: '456',
      topicId: 'topic-1',
      pagination: { offset: 20, limit: 20 },
    }])
  })

  it('message:fetch:topic syncs topics before fetching when topMessageId is missing locally', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)
    ctx.setCurrentAccountId('account-1')

    const mockMessages = [
      new Api.Message({
        id: 123,
        peerId: new Api.PeerChannel({ channelId: bigInt(456) }),
        message: 'Synced topic message',
        date: Math.floor(Date.now() / 1000),
      }),
    ]

    async function* fetchTopicMessages() {
      yield* mockMessages
    }

    const dbModels = {
      chatModels: {
        isChatAccessibleByAccount: vi.fn(async () => ({ expect: () => true })),
        findChatAccessHash: vi.fn(async () => ({ expect: () => ({ accessHash: '999', type: 'supergroup' }) })),
      },
      chatTopicModels: {
        findTopMessageId: vi.fn()
          .mockResolvedValueOnce({ expect: () => undefined })
          .mockResolvedValueOnce({ expect: () => '888' }),
        recordTopics: vi.fn(async (_db, topics) => topics),
      },
      chatMessageModels: {
        assignTopicForRootMessages: vi.fn(async () => ({ expect: () => 0 })),
      },
    } as unknown as Models

    const dialogService = {
      fetchTopics: vi.fn(async () => ({
        expect: () => [{
          chatId: '456',
          topicId: 'topic-1',
          topMessageId: '888',
          title: 'Topic title',
        }],
      })),
    }

    const mockMessageService = {
      fetchTopicMessages: vi.fn(() => fetchTopicMessages()),
    }

    registerMessageEventHandlers(ctx, logger, dbModels, dialogService as any)(mockMessageService as any)

    const processedMessages: Api.Message[] = []
    ctx.emitter.on(CoreEventType.MessageProcess, ({ messages }) => {
      processedMessages.push(...messages)
    })

    ctx.emitter.emit(CoreEventType.MessageFetchTopic, {
      chatId: '456',
      topicId: 'topic-1',
      pagination: { offset: 0, limit: 20 },
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(dbModels.chatModels.findChatAccessHash).toHaveBeenCalledWith(ctx.getDB(), 'account-1', '456')
    expect(dialogService.fetchTopics).toHaveBeenCalledWith('456', '999')
    expect(dbModels.chatTopicModels.recordTopics).toHaveBeenCalledWith(ctx.getDB(), [{
      chatId: '456',
      topicId: 'topic-1',
      topMessageId: '888',
      title: 'Topic title',
    }], 'telegram', 'account-1')
    expect(dbModels.chatMessageModels.assignTopicForRootMessages).toHaveBeenCalledWith(ctx.getDB(), '456', [{
      rootMessageId: '888',
      topicId: 'topic-1',
    }])
    expect(mockMessageService.fetchTopicMessages).toHaveBeenCalledWith('456', '888', expect.objectContaining({
      chatId: '456',
      topicId: 'topic-1',
      pagination: { offset: 0, limit: 20 },
    }))
    expect(processedMessages).toEqual(mockMessages)
  })

  it('message:fetch:topic ignores the General topic sentinel', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)

    const dbModels = {
      chatTopicModels: {
        findTopMessageId: vi.fn(),
      },
    } as unknown as Models

    const mockMessageService = {
      fetchTopicMessages: vi.fn(),
    }

    registerMessageEventHandlers(ctx, logger, dbModels)(mockMessageService as any)

    ctx.emitter.emit(CoreEventType.MessageFetchTopic, {
      chatId: '456',
      topicId: '',
      pagination: { offset: 0, limit: 20 },
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(dbModels.chatTopicModels.findTopMessageId).not.toHaveBeenCalled()
    expect(mockMessageService.fetchTopicMessages).not.toHaveBeenCalled()
  })
})
