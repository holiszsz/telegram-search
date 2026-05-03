import type { CoreContext, CoreEmitter } from '../../context'
import type { CoreUserEntity, FromCoreEvent, ToCoreEvent } from '../../types/events'

import bigInt from 'big-integer'

import { useLogger } from '@guiiai/logg'
import { Api } from 'telegram'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMessageService } from '../message'

const logger = useLogger()

function createMockCtx(client: any) {
  const withError = vi.fn((error: unknown, description?: string) => {
    const base = error instanceof Error ? error : new Error(String(error))
    return description ? new Error(description, { cause: base }) : base
  })

  const ctx: CoreContext = {
    emitter: { emit: vi.fn(), on: vi.fn() } as unknown as CoreEmitter,
    toCoreEvents: new Set<keyof ToCoreEvent>(),
    fromCoreEvents: new Set<keyof FromCoreEvent>(),
    wrapEmitterEmit: () => {},
    wrapEmitterOn: () => {},
    setClient: () => {},
    getClient: () => client,
    setCurrentAccountId: () => {},
    getCurrentAccountId: () => '',
    getDB: () => {
      throw new Error('DB not needed in this test')
    },
    withError,
    cleanup: () => {},
    setMyUser: () => {},
    getMyUser: () => ({}) as unknown as CoreUserEntity,
    getAccountSettings: async () => ({}) as any,
    setAccountSettings: async () => {},
    metrics: undefined,
  }

  return { ctx, withError }
}

describe('services/message', () => {
  const entityService = {
    getInputPeer: vi.fn(async () => new Api.InputPeerChannel({ channelId: bigInt(123), accessHash: bigInt(456) })),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetchSpecificMessages propagates Telegram fetch failures', async () => {
    const client = {
      isUserAuthorized: vi.fn(async () => true),
      getMessages: vi.fn(async () => {
        throw new Error('telegram down')
      }),
    }

    const { ctx } = createMockCtx(client)
    const service = createMessageService(ctx, logger, entityService as any)

    await expect(service.fetchSpecificMessages('chat-1', [1, 2])).rejects.toThrow('telegram down')
    expect(client.getMessages).toHaveBeenCalledTimes(1)
  })

  it('fetchUnreadMessages propagates dialog lookup failures', async () => {
    const client = {
      isUserAuthorized: vi.fn(async () => true),
      invoke: vi.fn(async () => {
        throw new Error('peer dialogs failed')
      }),
      getMessages: vi.fn(),
    }

    const { ctx } = createMockCtx(client)
    const service = createMessageService(ctx, logger, entityService as any)

    await expect(service.fetchUnreadMessages('chat-1')).rejects.toThrow('peer dialogs failed')
    expect(client.invoke).toHaveBeenCalledTimes(1)
    expect(client.getMessages).not.toHaveBeenCalled()
  })

  it('fetchTopicMessages uses maxId as a GetReplies offset cursor', async () => {
    const message = new Api.Message({
      id: 119,
      peerId: new Api.PeerChannel({ channelId: bigInt(123) }),
      message: 'topic message',
      date: Math.floor(Date.now() / 1000),
    })
    const client = {
      isUserAuthorized: vi.fn(async () => true),
      invoke: vi.fn(async (_request: Api.messages.GetReplies) => new Api.messages.Messages({
        messages: [message],
        chats: [],
        users: [],
      })),
    }

    const { ctx } = createMockCtx(client)
    const service = createMessageService(ctx, logger, entityService as any)
    const result: Api.Message[] = []

    for await (const fetchedMessage of service.fetchTopicMessages('chat-1', '777', {
      pagination: { offset: 50, limit: 20 },
      maxId: 120,
    })) {
      result.push(fetchedMessage)
    }

    expect(client.invoke).toHaveBeenCalledTimes(1)
    const request = client.invoke.mock.calls[0]![0]

    // Deep topic pagination should use Telegram's message-id cursor instead of
    // relying on count-based addOffset scans.
    expect(request).toBeInstanceOf(Api.messages.GetReplies)
    expect(request.offsetId).toBe(120)
    expect(request.addOffset).toBe(0)
    expect(request.maxId).toBe(120)
    expect(result).toEqual([message])
  })
})
