import type { Logger } from '@guiiai/logg'

import type { CoreContext } from '../context'
import type { AccountModels } from '../models/accounts'
import type { ChatMessageModels } from '../models/chat-message'
import type { ChatModels } from '../models/chats'

import { CoreEventType } from '../types/events'

export async function applyDeleteUpdate(
  ctx: CoreContext,
  logger: Logger,
  models: {
    accountModels: AccountModels
    chatModels: ChatModels
    chatMessageModels: ChatMessageModels
  },
  update: {
    messageIds: string[]
    chatId?: string
    pts?: number
    date?: number
    isChannel: boolean
  },
) {
  const { messageIds, chatId, pts, date, isChannel } = update
  if (messageIds.length === 0) {
    return 0
  }

  if (isChannel && !chatId) {
    logger.withFields({ messageIds, pts }).warn('Ignoring channel delete update without chat id')
    return 0
  }

  const accountId = ctx.getCurrentAccountId()
  const deletedAt = Date.now()
  const deletedCount = await models.chatMessageModels.softDeleteMessages(
    ctx.getDB(),
    accountId,
    messageIds,
    {
      chatId,
      deletedAt,
    },
  )

  if (isChannel && chatId && pts !== undefined) {
    await models.chatModels.updateChatPts(ctx.getDB(), accountId, chatId, pts)
  }
  else if (!isChannel && pts !== undefined) {
    await models.accountModels.updateAccountState(ctx.getDB(), accountId, {
      pts,
      date,
    })
  }

  ctx.emitter.emit(CoreEventType.MessageDeleted, {
    chatId,
    messageIds,
    deletedAt,
  })

  logger.withFields({ messageIds, chatId, isChannel, deletedCount, deletedAt }).verbose('Messages soft-deleted')

  return deletedCount
}
