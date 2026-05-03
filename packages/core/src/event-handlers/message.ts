import type { Logger } from '@guiiai/logg'

import type { CoreContext } from '../context'
import type { Models } from '../models'
import type { MessageService } from '../services'
import type { DialogService } from '../services/dialog'
import type { MessageResolverService } from '../services/message-resolver'
import type { FetchMessageOpts } from '../types/events'
import type { CoreMessage } from '../types/message'

import { Api } from 'telegram/tl'
import { v4 as uuidv4 } from 'uuid'

import { MESSAGE_PROCESS_BATCH_SIZE } from '../constants'
import { CoreEventType } from '../types/events'
import { convertToCoreMessage } from '../utils/message'
import { syncTopicsAndAttachRoots } from './utils/sync-topics'

export function registerMessageEventHandlers(ctx: CoreContext, logger: Logger, dbModels?: Models, dialogService?: DialogService, messageResolverService?: MessageResolverService) {
  logger = logger.withContext('core:message:event')

  return (messageService: MessageService) => {
    function toCoreMessages(messages: Api.Message[]): CoreMessage[] {
      return messages
        .map(convertToCoreMessage)
        .map(result => result.unwrap())
    }

    async function emitFetchedMessages(
      messageSource: AsyncGenerator<Api.Message>,
      options: { topicIdOverride?: string } = {},
    ) {
      let messages: Api.Message[] = []
      for await (const message of messageSource) {
        messages.push(message)

        const batchSize = MESSAGE_PROCESS_BATCH_SIZE
        if (messages.length >= batchSize) {
          logger.withFields({
            total: messages.length,
            batchSize,
          }).debug('Processing message batch')

          ctx.emitter.emit(CoreEventType.MessageProcess, { messages, topicIdOverride: options.topicIdOverride })
          messages = []
        }
      }

      if (messages.length > 0) {
        ctx.emitter.emit(CoreEventType.MessageProcess, { messages, topicIdOverride: options.topicIdOverride })
      }
    }

    async function collectMessages(messageSource: AsyncGenerator<Api.Message>) {
      const messages: Api.Message[] = []
      for await (const message of messageSource) {
        messages.push(message)
      }
      return messages
    }

    async function fetchStoredMessages(opts: FetchMessageOpts) {
      if (!dbModels) {
        return []
      }

      const accountId = ctx.getCurrentAccountId()
      return (await dbModels.chatMessageModels.fetchMessagesWithPhotos(
        ctx.getDB(),
        dbModels.photoModels,
        accountId,
        opts.chatId,
        opts.pagination,
        {
          includeDeleted: true,
          minId: opts.minId,
          maxId: opts.maxId,
        },
      )).unwrap()
    }

    function isStoredPageComplete(messages: CoreMessage[], opts: FetchMessageOpts) {
      return messages.length >= opts.pagination.limit
    }

    async function ensureTopicMetadata(chatId: string, topicId: string): Promise<{ found: boolean, fallbackToStorage: boolean }> {
      if (!dbModels) {
        ctx.withError('Missing db models', 'Cannot resolve forum topic metadata')
        return { found: false, fallbackToStorage: false }
      }

      const accountId = ctx.getCurrentAccountId()
      const hasAccess = (await dbModels.chatModels.isChatAccessibleByAccount(ctx.getDB(), accountId, chatId)).expect('Failed to check chat access')
      if (!hasAccess) {
        ctx.withError('Unauthorized chat access', 'Account does not have access to requested topic messages')
        return { found: false, fallbackToStorage: false }
      }

      const topMessageId = (await dbModels.chatTopicModels.findTopMessageId(ctx.getDB(), chatId, topicId)).expect('Failed to resolve topic metadata')
      if (topMessageId) {
        return { found: true, fallbackToStorage: true }
      }

      if (!dialogService) {
        ctx.withError('Missing dialog service', 'Cannot sync forum topic metadata')
        return { found: false, fallbackToStorage: true }
      }

      const chatAccess = (await dbModels.chatModels.findChatAccessHash(ctx.getDB(), accountId, chatId)).expect('Failed to resolve chat access hash')
      if (!chatAccess?.accessHash) {
        ctx.withError('Missing chat access hash', 'Cannot sync forum topics without a stored access hash')
        return { found: false, fallbackToStorage: true }
      }

      const topics = (await dialogService.fetchTopics(chatId, chatAccess.accessHash)).expect('Failed to fetch forum topics')
      await syncTopicsAndAttachRoots(ctx.getDB(), chatId, accountId, topics, dbModels)

      const syncedTopMessageId = (await dbModels.chatTopicModels.findTopMessageId(ctx.getDB(), chatId, topicId)).expect('Failed to resolve synced topic metadata')
      return { found: syncedTopMessageId != null, fallbackToStorage: true }
    }

    ctx.emitter.on(CoreEventType.MessageFetch, async (opts) => {
      logger.withFields({ chatId: opts.chatId, minId: opts.minId, maxId: opts.maxId }).verbose('Fetching messages')

      try {
        if (!dbModels || !messageResolverService) {
          await emitFetchedMessages(messageService.fetchMessages(opts.chatId, opts))
          return
        }

        const storedMessages = await fetchStoredMessages(opts)
        if (isStoredPageComplete(storedMessages, opts)) {
          ctx.emitter.emit(CoreEventType.MessageData, { messages: storedMessages })
          return
        }

        const telegramMessages = await collectMessages(messageService.fetchMessages(opts.chatId, opts))
        if (telegramMessages.length > 0) {
          await messageResolverService.processMessages(telegramMessages, {
            emitMessageData: false,
          })
        }

        const mergedMessages = await fetchStoredMessages(opts)
        ctx.emitter.emit(CoreEventType.MessageData, { messages: mergedMessages })
      }
      catch (error) {
        ctx.withError(error, 'Failed to fetch messages')
      }
    })

    ctx.emitter.on(CoreEventType.MessageFetchTopic, async (opts) => {
      logger.withFields({ chatId: opts.chatId, topicId: opts.topicId, minId: opts.minId, maxId: opts.maxId }).verbose('Fetching topic messages')

      if (opts.topicId === '') {
        logger.withFields({ chatId: opts.chatId }).warn('Ignoring empty topic id for topic message fetch')
        return
      }

      try {
        const { found, fallbackToStorage } = await ensureTopicMetadata(opts.chatId, opts.topicId)
        if (!found) {
          if (fallbackToStorage) {
            ctx.emitter.emit(CoreEventType.StorageFetchMessages, {
              chatId: opts.chatId,
              topicId: opts.topicId,
              pagination: opts.pagination,
            })
          }
          return
        }

        await emitFetchedMessages(messageService.fetchTopicMessages(opts.chatId, opts.topicId, opts), {
          topicIdOverride: opts.topicId,
        })
      }
      catch (error) {
        ctx.withError(error, 'Failed to fetch topic messages')
      }
    })

    ctx.emitter.on(CoreEventType.MessageFetchSpecific, async ({ chatId, messageIds }) => {
      logger.withFields({ chatId, count: messageIds.length }).verbose('Fetching specific messages for media')

      try {
        // Fetch specific messages by their IDs from Telegram
        const messages = await messageService.fetchSpecificMessages(chatId, messageIds)

        if (messages.length > 0) {
          logger.withFields({ chatId, count: messages.length }).verbose('Fetched specific messages, processing for media')
          ctx.emitter.emit(CoreEventType.MessageProcess, { messages })
        }
      }
      catch (error) {
        logger.withError(error as Error).warn('Failed to fetch specific messages')
      }
    })

    ctx.emitter.on(CoreEventType.MessageSend, async ({ chatId, content }) => {
      logger.withFields({ chatId, content }).verbose('Sending message')
      const updatedMessage = (await messageService.sendMessage(chatId, content)).unwrap()

      switch (updatedMessage.className) {
        case 'Updates':
          updatedMessage.updates.forEach((update) => {
            if ('message' in update && update.message instanceof Api.Message) {
              ctx.emitter.emit(CoreEventType.MessageProcess, { messages: [update.message] })
            }
          })
          break
        case 'UpdateShortSentMessage': {
          const sender = ctx.getMyUser()
          ctx.emitter.emit(CoreEventType.MessageData, {
            messages: [{
              uuid: uuidv4(),
              platform: 'telegram',
              platformMessageId: updatedMessage.id.toString(),
              chatId,
              fromId: sender.id,
              fromName: sender.name,
              content,
              reply: { isReply: false, replyToId: undefined, replyToName: undefined },
              forward: { isForward: false, forwardFromChatId: undefined, forwardFromChatName: undefined, forwardFromMessageId: undefined },
              platformTimestamp: updatedMessage.date,
            }],
          })
          break
        }
        default:
          logger.withFields({ message: updatedMessage }).warn('Unknown message type')
          break
      }

      logger.withFields({ content }).verbose('Message sent')
    })

    ctx.emitter.on(CoreEventType.MessageReprocess, async ({ chatId, messageIds, resolvers }) => {
      // Validate input
      if (messageIds.length === 0) {
        logger.withFields({ chatId }).warn('Re-process called with empty messageIds array')
        return
      }

      logger.withFields({ chatId, messageIds, resolvers }).verbose('Re-processing messages')

      try {
        // Fetch specific messages by their IDs from Telegram
        const messages = await messageService.fetchSpecificMessages(chatId, messageIds)

        if (messages.length === 0) {
          logger.withFields({ chatId, messageIds }).warn('No messages found for re-processing')
          return
        }

        logger.withFields({ count: messages.length, resolvers }).verbose('Fetched messages for re-processing')

        // NOTE: The 'resolvers' parameter is currently not passed to message:process.
        // The message:process event runs all enabled resolvers (not disabled in account settings).
        // This is acceptable for the initial implementation since re-downloading media
        // will also update other resolver outputs (embeddings, tokens, etc.) if enabled.
        // Future enhancement: Add resolver filtering to message:process event to run only
        // specific resolvers and avoid unnecessary work.
        //
        // Force refetch to skip database cache and re-download from Telegram.
        // This is necessary when media files are missing from storage (404 errors).
        ctx.emitter.emit(CoreEventType.MessageProcess, { messages, forceRefetch: true })
      }
      catch (error) {
        logger.withError(error as Error).warn('Failed to re-process messages')
        ctx.withError(error as Error, 'Failed to re-process messages')
      }
    })

    ctx.emitter.on(CoreEventType.MessageFetchUnread, async ({ chatId, limit, startTime }) => {
      logger.withFields({ chatId, limit, startTime }).verbose('Fetching unread messages')
      try {
        const messages = await messageService.fetchUnreadMessages(chatId, { limit, startTime })
        // Reverse to have chronological order (oldest first) which is better for LLM summary
        // getMessages usually returns newest first.
        messages.reverse()

        const coreMessages = toCoreMessages(messages)
        ctx.emitter.emit(CoreEventType.MessageUnreadData, { messages: coreMessages })
      }
      catch (e) {
        ctx.withError(e, 'Failed to fetch unread messages')
      }
    })

    ctx.emitter.on(CoreEventType.MessageFetchSummary, async ({ chatId, limit, mode, requestId }) => {
      logger.withFields({ chatId, limit, mode, requestId }).verbose('Fetching summary messages')
      try {
        if (mode === 'unread') {
          const unread = await messageService.fetchUnreadMessages(chatId, { limit })
          unread.reverse()
          ctx.emitter.emit(CoreEventType.MessageSummaryData, {
            messages: toCoreMessages(unread),
            mode: 'unread',
            requestId,
          })
          return
        }

        const now = new Date()
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const startOfTodayTs = Math.floor(startOfToday.getTime() / 1000)
        const startTime = mode === 'today'
          ? startOfTodayTs
          : Math.floor(Date.now() / 1000) - 24 * 60 * 60

        const recent = await messageService.fetchRecentMessagesByTimeRange(chatId, { startTime, limit })
        recent.reverse()

        ctx.emitter.emit(CoreEventType.MessageSummaryData, {
          messages: toCoreMessages(recent),
          mode,
          requestId,
        })
      }
      catch (e) {
        ctx.withError(e, 'Failed to fetch summary messages')
      }
    })

    ctx.emitter.on(CoreEventType.MessageRead, async ({ chatId }) => {
      logger.withFields({ chatId }).verbose('Marking messages as read')
      await messageService.markAsRead(chatId)
    })
  }
}
