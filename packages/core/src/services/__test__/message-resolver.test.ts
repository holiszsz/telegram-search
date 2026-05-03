import type { Models } from '../../models'

import bigInt from 'big-integer'

import { useLogger } from '@guiiai/logg'
import { Ok } from '@unbird/result'
import { Api } from 'telegram'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getMockEmptyDB } from '../../../mock'
import { createCoreContext } from '../../context'
import { chatMessageModels } from '../../models/chat-message'
import { CoreEventType } from '../../types/events'
import { generateDefaultAccountSettings } from '../../utils/account-settings'
import { createMessageResolverService } from '../message-resolver'

const logger = useLogger()

function createModels(): Models {
  return {
    accountSettingsModels: {
      fetchSettingsByAccountId: vi.fn(async () => Ok(generateDefaultAccountSettings())),
    },
  } as unknown as Models
}

function createTopicReplyMessage() {
  return {
    id: 10,
    date: 1700000000,
    message: 'Topic reply',
    peerId: new Api.PeerChannel({ channelId: bigInt(456) }),
    sender: new Api.User({ id: bigInt(42), firstName: 'Alice' }),
    senderId: bigInt(42),
    replyTo: {
      replyToTopId: bigInt(777),
      replyToMsgId: bigInt(778),
    },
  } as unknown as Api.Message
}

describe('message resolver service', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies topicIdOverride before recording and emitting fetched topic messages', async () => {
    const ctx = createCoreContext(getMockEmptyDB, createModels(), logger)
    ctx.setCurrentAccountId('account-1')

    vi.spyOn(chatMessageModels, 'recordMessages').mockImplementation(async (_db, _accountId, messages) => {
      return messages.map(message => ({
        id: message.uuid,
        in_chat_id: message.chatId,
        platform_message_id: message.platformMessageId,
        created_at: 1,
        updated_at: 1,
        deleted_at: 0,
      })) as any
    })

    const receivedMessages: Array<{ topicId?: string }> = []
    ctx.emitter.on(CoreEventType.MessageData, ({ messages }) => {
      receivedMessages.push(...messages)
    })

    const service = createMessageResolverService(ctx, logger, { registry: new Map() } as any)
    await service.processMessages([createTopicReplyMessage()], { topicIdOverride: 'topic-1' })

    // Telegram topic replies can carry the root message id in replyToTopId;
    // topic views need the clicked topic id for storage and frontend filters.
    expect(chatMessageModels.recordMessages).toHaveBeenCalledWith(
      ctx.getDB(),
      'account-1',
      [expect.objectContaining({ topicId: 'topic-1' })],
    )
    expect(receivedMessages).toEqual([expect.objectContaining({ topicId: 'topic-1' })])
  })
})
