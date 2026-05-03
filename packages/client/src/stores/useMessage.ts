import type { CorePagination } from '@tg-search/common'
import type { CoreMessage } from '@tg-search/core'

import type { VersionedScopedStorage } from '../utils/versioned-local-cache'

import { useLogger } from '@guiiai/logg'
import { CoreEventType } from '@tg-search/core'
import { useLocalStorage } from '@vueuse/core'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, nextTick, ref, toValue } from 'vue'

import { useBridge } from '../composables/useBridge'
import { MessageWindow } from '../composables/useMessageWindow'
import { createMediaBlob } from '../utils/blob'
import { waitForEventWithTimeout } from '../utils/event-queue'
import { determineMessageDirection } from '../utils/message'
import { readVersionedScopedCache, writeVersionedScopedCache } from '../utils/versioned-local-cache'
import { useSessionStore } from './useSession'

export const useMessageStore = defineStore('message', () => {
  const MESSAGE_EDIT_ANIMATION_MS = 320
  const MESSAGE_DELETE_ANIMATION_MS = 200
  const MESSAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
  const MESSAGE_CACHE_VERSION = 1
  const MAX_CACHED_MESSAGE_SCOPES = 8

  const sessionStore = useSessionStore()
  const currentChatId = ref<string>()
  const currentTopicId = ref<string>()
  const messageWindow = ref<MessageWindow>()
  const allSenderNames = useLocalStorage<VersionedScopedStorage<Record<string, string>>>('v3/message/sender-names', {})
  const allEditedMessageMarks = useLocalStorage<VersionedScopedStorage<Record<string, number>>>('v3/message/edited-marks', {})
  const pendingEditHints = ref<Record<string, number>>({})
  const editingMessageKeys = ref<Record<string, number>>({})
  const deletingMessageKeys = ref<Record<string, number>>({})

  const bridge = useBridge()

  const logger = useLogger('MessageStore')
  const cacheOptions = {
    maxScopes: MAX_CACHED_MESSAGE_SCOPES,
    ttlMs: MESSAGE_CACHE_TTL_MS,
    version: MESSAGE_CACHE_VERSION,
  } as const

  function createRequestId() {
    return `message-store:${Date.now()}:${Math.random().toString(36).slice(2)}`
  }

  const senderNames = computed({
    get: () => {
      const accountId = sessionStore.activeSession?.me?.id?.toString()
      if (!accountId) {
        return {}
      }

      return readVersionedScopedCache<Record<string, string>>(allSenderNames.value, accountId, {}, cacheOptions)
    },
    set: (next) => {
      const accountId = sessionStore.activeSession?.me?.id?.toString()
      if (!accountId) {
        return
      }

      allSenderNames.value = writeVersionedScopedCache<Record<string, string>>(allSenderNames.value, accountId, next, cacheOptions)
    },
  })

  const editedMessageMarks = computed({
    get: () => {
      const sessionId = sessionStore.activeSessionId
      if (!sessionId) {
        return {}
      }

      return readVersionedScopedCache<Record<string, number>>(allEditedMessageMarks.value, sessionId, {}, cacheOptions)
    },
    set: (next) => {
      const sessionId = sessionStore.activeSessionId
      if (!sessionId) {
        return
      }

      allEditedMessageMarks.value = writeVersionedScopedCache<Record<string, number>>(allEditedMessageMarks.value, sessionId, next, cacheOptions)
    },
  })

  function hasResolvedSenderName(name: string | undefined, fromId: string | undefined) {
    if (!name?.trim() || !fromId?.trim()) {
      return false
    }

    return name !== fromId
  }

  function backfillWindowSenderName(fromId: string, fromName: string) {
    if (!messageWindow.value) {
      return
    }

    let hasChanges = false

    for (const [messageId, message] of messageWindow.value.messages.entries()) {
      if (message.fromId !== fromId || hasResolvedSenderName(message.fromName, message.fromId)) {
        continue
      }

      messageWindow.value.messages.set(messageId, {
        ...message,
        fromName,
      })
      hasChanges = true
    }

    if (hasChanges) {
      logger.debug(`Backfilled sender name for ${fromId}`)
    }
  }

  function normalizeSenderNames(messages: CoreMessage[]) {
    if (messages.length === 0) {
      return messages
    }

    const resolvedNames = new Map(Object.entries(senderNames.value))

    for (const message of messages) {
      if (hasResolvedSenderName(message.fromName, message.fromId)) {
        resolvedNames.set(message.fromId, message.fromName)
      }
    }

    const normalizedMessages = messages.map((message) => {
      const resolvedName = resolvedNames.get(message.fromId)

      if (!resolvedName || hasResolvedSenderName(message.fromName, message.fromId)) {
        return message
      }

      return {
        ...message,
        fromName: resolvedName,
      }
    })

    // Batch all new sender names into a single localStorage write
    const newNames: Record<string, string> = {}
    for (const message of normalizedMessages) {
      if (hasResolvedSenderName(message.fromName, message.fromId)) {
        if (senderNames.value[message.fromId] !== message.fromName) {
          newNames[message.fromId] = message.fromName
        }
        backfillWindowSenderName(message.fromId, message.fromName)
      }
    }
    if (Object.keys(newNames).length > 0) {
      senderNames.value = { ...senderNames.value, ...newNames }
    }

    return normalizedMessages
  }

  function reset() {
    logger.log('Resetting message store for account switch')
    currentChatId.value = undefined
    currentTopicId.value = undefined
    messageWindow.value?.clear()
    messageWindow.value = undefined
    pendingEditHints.value = {}
    editingMessageKeys.value = {}
    deletingMessageKeys.value = {}
  }

  function toMessageKey(chatId: string, platformMessageId: string) {
    return `${chatId}:${platformMessageId}`
  }

  function isMessageMarkedEdited(message: Pick<CoreMessage, 'chatId' | 'platformMessageId'>) {
    return !!pendingEditHints.value[toMessageKey(message.chatId, message.platformMessageId)]
  }

  function persistEditedMessage(chatId: string, messageId: string) {
    const key = toMessageKey(chatId, messageId)

    if (editedMessageMarks.value[key]) {
      return
    }

    editedMessageMarks.value = {
      ...editedMessageMarks.value,
      [key]: Date.now(),
    }
  }

  function queueRealtimeEditHint(chatId: string, messageId: string) {
    persistEditedMessage(chatId, messageId)
    pendingEditHints.value = {
      ...pendingEditHints.value,
      [toMessageKey(chatId, messageId)]: Date.now(),
    }
  }

  function markMessageEdited(chatId: string, messageId: string) {
    const key = toMessageKey(chatId, messageId)
    persistEditedMessage(chatId, messageId)

    pendingEditHints.value = Object.fromEntries(
      Object.entries(pendingEditHints.value).filter(([entryKey]) => entryKey !== key),
    )

    editingMessageKeys.value = {
      ...editingMessageKeys.value,
      [key]: Date.now(),
    }

    window.setTimeout(() => {
      const { [key]: _, ...rest } = editingMessageKeys.value
      editingMessageKeys.value = rest
    }, MESSAGE_EDIT_ANIMATION_MS)
  }

  function startDeletingMessages(chatId: string | undefined, messageIds: string[], deletedAt: number) {
    if (!messageWindow.value || messageIds.length === 0) {
      return
    }

    const activeChatId = currentChatId.value
    const targetChatId = activeChatId ?? chatId
    if (!targetChatId) {
      return
    }
    if (chatId && activeChatId && chatId !== activeChatId) {
      return
    }

    const nextDeleting = { ...deletingMessageKeys.value }
    const existingIds = messageIds.filter(messageId => messageWindow.value!.has(messageId))
    if (existingIds.length === 0) {
      return
    }

    for (const messageId of existingIds) {
      nextDeleting[toMessageKey(targetChatId, messageId)] = Date.now()
      messageWindow.value.update(messageId, message => ({
        ...message,
        deletedAt,
      }))
    }
    deletingMessageKeys.value = nextDeleting

    window.setTimeout(() => {
      deletingMessageKeys.value = Object.fromEntries(
        Object.entries(deletingMessageKeys.value).filter(([key]) => !existingIds.some(messageId => key === toMessageKey(targetChatId, messageId))),
      )
    }, MESSAGE_DELETE_ANIMATION_MS)
  }

  function isMessageDeleting(message: Pick<CoreMessage, 'chatId' | 'platformMessageId'>) {
    return !!deletingMessageKeys.value[toMessageKey(message.chatId, message.platformMessageId)]
  }

  function isMessageDeleted(message: Pick<CoreMessage, 'deletedAt'>) {
    return (message.deletedAt ?? 0) > 0
  }

  function isMessageEditing(message: Pick<CoreMessage, 'chatId' | 'platformMessageId'>) {
    return !!editingMessageKeys.value[toMessageKey(message.chatId, message.platformMessageId)]
  }

  function isMessageEdited(message: Pick<CoreMessage, 'chatId' | 'platformMessageId' | 'createdAt' | 'updatedAt' | 'deletedAt'>) {
    if (isMessageDeleted(message)) {
      return false
    }

    if (isMessageEditing(message)) {
      return true
    }

    if (editedMessageMarks.value[toMessageKey(message.chatId, message.platformMessageId)]) {
      return true
    }

    if (message.updatedAt == null) {
      return false
    }

    return (message.createdAt ?? 0) < message.updatedAt
  }

  async function syncEditedMessageMarks(chatId: string, messageIds: string[]) {
    const unresolvedMessageIds = messageIds.filter((messageId) => {
      return !editedMessageMarks.value[toMessageKey(chatId, messageId)]
    })

    if (unresolvedMessageIds.length === 0) {
      return
    }

    const requestId = createRequestId()

    bridge.sendEvent(CoreEventType.StorageFetchMessageEditMarks, {
      chatId,
      messageIds: unresolvedMessageIds,
      requestId,
    })

    try {
      const { chatId: responseChatId, editedMessageIds } = await waitForEventWithTimeout(bridge.waitForEvent(
        CoreEventType.StorageMessageEditMarks,
        data => data.requestId === requestId,
      ))
      if (responseChatId !== chatId || editedMessageIds.length === 0) {
        return
      }

      for (const messageId of editedMessageIds) {
        persistEditedMessage(chatId, messageId)
      }
    }
    catch (error) {
      logger.withError(error).debug('Failed to sync edited message marks from storage')
    }
  }

  function replaceMessages(messages: CoreMessage[], options?: { chatId?: string, limit?: number, topicId?: string }) {
    const normalizedMessages = normalizeSenderNames(messages)
    const previousChatId = currentChatId.value
    const nextChatId = options?.chatId ?? previousChatId
    const nextTopicId = options?.topicId
    const fallbackSize = Math.max(normalizedMessages.length, 50)
    const desiredSize = options?.limit ?? Math.max(messageWindow.value?.maxSize ?? 0, fallbackSize)

    const shouldResetWindow = !messageWindow.value
      || messageWindow.value.maxSize < desiredSize
      || (nextChatId && previousChatId !== nextChatId)
      || currentTopicId.value !== nextTopicId

    if (nextChatId)
      currentChatId.value = nextChatId
    currentTopicId.value = nextTopicId

    if (shouldResetWindow)
      messageWindow.value = new MessageWindow(desiredSize)
    else
      messageWindow.value!.clear()

    messageWindow.value!.addBatch(normalizedMessages, 'initial')

    if (nextChatId && normalizedMessages.length > 0) {
      void syncEditedMessageMarks(nextChatId, normalizedMessages.map(message => message.platformMessageId))
    }
  }

  async function loadMessageContext(
    chatId: string,
    messageId: string,
    options: { before?: number, after?: number, limit?: number, topicId?: string } = {},
  ) {
    const before = options.before ?? 20
    const after = options.after ?? 20
    const limit = options.limit ?? Math.max(messageWindow.value?.maxSize ?? 0, before + after + 1, 50)
    const topicId = options.topicId

    bridge.sendEvent(CoreEventType.StorageFetchMessageContext, {
      chatId,
      messageId,
      topicId,
      before,
      after,
    })

    const { messages } = await waitForEventWithTimeout(bridge.waitForEvent(CoreEventType.StorageMessagesContext))

    replaceMessages(messages, { chatId, limit, topicId })

    return messages
  }

  async function pushMessages(messages: CoreMessage[]) {
    if (!currentChatId.value) {
      return
    }

    const filteredMessages = normalizeSenderNames(messages)
      .filter(msg => msg.chatId === currentChatId.value)
      .filter(msg => currentTopicId.value === undefined || (msg.topicId ?? '') === currentTopicId.value)
      .map((message) => {
        const existingMessage = messageWindow.value?.get(message.platformMessageId)
        const hasEditHint = isMessageMarkedEdited(message)
        const isEditedContent = !!existingMessage
          && (
            existingMessage.content !== message.content
            || existingMessage.deletedAt !== message.deletedAt
          )

        const mergedBaseMessage = existingMessage
          ? {
              ...existingMessage,
              ...message,
              uuid: existingMessage.uuid,
              createdAt: message.createdAt ?? existingMessage.createdAt,
              updatedAt: message.updatedAt ?? existingMessage.updatedAt,
              deletedAt: message.deletedAt ?? existingMessage.deletedAt,
              media: message.media?.map(createMediaBlob) ?? existingMessage.media,
            }
          : {
              ...message,
              media: message.media?.map(createMediaBlob),
            }

        if (!existingMessage || (!hasEditHint && !isEditedContent)) {
          if ((mergedBaseMessage.updatedAt ?? 0) > (mergedBaseMessage.createdAt ?? 0)) {
            persistEditedMessage(mergedBaseMessage.chatId, mergedBaseMessage.platformMessageId)
          }
          return mergedBaseMessage
        }

        markMessageEdited(message.chatId, message.platformMessageId)

        return {
          ...mergedBaseMessage,
          updatedAt: message.updatedAt ?? Math.max(existingMessage.updatedAt ?? 0, Date.now()),
        }
      })

    const direction = determineMessageDirection(filteredMessages, messageWindow.value)

    logger.debug(`Push ${filteredMessages.length} messages (${direction})`, filteredMessages)

    if (filteredMessages.length === 0) {
      return
    }

    if (!messageWindow.value) {
      logger.warn('Message window not initialized')
      return
    }

    messageWindow.value.addBatch(
      filteredMessages,
      direction,
    )

    void syncEditedMessageMarks(
      currentChatId.value,
      filteredMessages.map(message => message.platformMessageId),
    )
  }

  function useFetchMessages(chatId: string, limit: number, topicId?: string | (() => string | undefined)) {
    const initialTopicId = toValue(topicId)
    // Only initialize if chatId changes
    if (currentChatId.value !== chatId || currentTopicId.value !== initialTopicId) {
      currentChatId.value = chatId
      currentTopicId.value = initialTopicId
      messageWindow.value?.clear()
      messageWindow.value = new MessageWindow(limit)
    }

    const isLoading = ref(false)

    async function fetchMessages(
      pagination: CorePagination & {
        minId?: number
        maxId?: number
      },
      direction: 'older' | 'newer' = 'older',
    ) {
      isLoading.value = true
      const activeTopicId = toValue(topicId)
      if (currentChatId.value !== chatId || currentTopicId.value !== activeTopicId) {
        currentChatId.value = chatId
        currentTopicId.value = activeTopicId
        messageWindow.value?.clear()
        messageWindow.value = new MessageWindow(limit)
      }

      logger.log(`Fetching messages for chat ${chatId}`, pagination.offset)

      // Then, fetch the messages from server & update the cache
      if (activeTopicId === undefined) {
        switch (direction) {
          case 'older':
            bridge.sendEvent(CoreEventType.MessageFetch, { chatId, pagination })
            break
          case 'newer':
            bridge.sendEvent(CoreEventType.MessageFetch, {
              chatId,
              pagination: {
                offset: 0,
                limit: pagination.limit,
              },
              minId: pagination.minId,
            })
            break
        }
      }
      else if (activeTopicId === '') {
        bridge.sendEvent(CoreEventType.StorageFetchMessages, {
          chatId,
          topicId: activeTopicId,
          pagination: direction === 'newer'
            ? { offset: 0, limit: pagination.limit }
            : pagination,
        })
      }
      else {
        const currentMinId = messageWindow.value?.minId
        const maxId = direction === 'older'
          && currentMinId !== undefined
          && Number.isFinite(currentMinId)
          ? currentMinId
          : pagination.maxId
        const topicPagination = direction === 'newer' || maxId
          ? { offset: 0, limit: pagination.limit }
          : pagination

        bridge.sendEvent(CoreEventType.MessageFetchTopic, {
          chatId,
          topicId: activeTopicId,
          pagination: topicPagination,
          minId: direction === 'newer' ? pagination.minId : undefined,
          maxId,
        })
      }

      try {
        const result = await waitForEventWithTimeout(Promise.race([
          bridge.waitForEvent(CoreEventType.MessageData),
          bridge.waitForEvent(CoreEventType.StorageMessages),
        ]))

        // Let the registered event handler push the fetched messages into the
        // store before callers continue with follow-up scroll logic.
        await nextTick()
        return result
      }
      catch {
        logger.warn('Message fetch timed out or failed')
        return undefined
      }
      finally {
        isLoading.value = false
      }
    }

    return {
      isLoading,
      fetchMessages,
    }
  }

  return {
    chatId: computed(() => currentChatId),
    sortedMessageIds: computed(() => messageWindow.value?.getSortedIds() ?? []),
    // TODO: too heavy to compute every time
    sortedMessageArray: computed(() => messageWindow.value?.getSortedIds().map(id => messageWindow.value!.get(id)!) ?? []),
    messageWindow: computed(() => messageWindow.value!),

    replaceMessages,
    reset,
    pushMessages,
    queueRealtimeEditHint,
    startDeletingMessages,
    isMessageDeleting,
    isMessageDeleted,
    isMessageEditing,
    isMessageEdited,
    isMessageMarkedEdited,
    useFetchMessages,
    loadMessageContext,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMessageStore, import.meta.hot))
}
