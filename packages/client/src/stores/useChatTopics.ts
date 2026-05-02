import type { CoreChatTopic } from '@tg-search/core/types'

import { CoreEventType } from '@tg-search/core'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useBridge } from '../composables/useBridge'
import { useSessionStore } from './useSession'

export const useChatTopicsStore = defineStore('chat-topics', () => {
  const bridge = useBridge()
  const sessionStore = useSessionStore()
  const topicsByScope = ref<Record<string, Record<string, CoreChatTopic[]>>>({})
  const fetchedChatIdsByScope = ref<Record<string, Record<string, boolean>>>({})

  const activeScopeKey = computed(() => {
    return sessionStore.activeSession?.me?.id?.toString()
      ?? sessionStore.activeSessionId
      ?? 'anonymous'
  })

  const topicsByChatId = computed(() => topicsByScope.value[activeScopeKey.value] ?? {})
  const fetchedChatIds = computed(() => fetchedChatIdsByScope.value[activeScopeKey.value] ?? {})

  function setScopedTopics(scopeKey: string, nextTopicsByChatId: Record<string, CoreChatTopic[]>) {
    topicsByScope.value = {
      ...topicsByScope.value,
      [scopeKey]: nextTopicsByChatId,
    }
  }

  function setScopedFetched(scopeKey: string, nextFetchedChatIds: Record<string, boolean>) {
    fetchedChatIdsByScope.value = {
      ...fetchedChatIdsByScope.value,
      [scopeKey]: nextFetchedChatIds,
    }
  }

  function setTopics(chatId: string, topics: CoreChatTopic[]) {
    const scopeKey = activeScopeKey.value
    setScopedTopics(scopeKey, {
      ...topicsByChatId.value,
      [chatId]: topics,
    })
    setScopedFetched(scopeKey, {
      ...fetchedChatIds.value,
      [chatId]: true,
    })
  }

  function getTopics(chatId: string) {
    return topicsByChatId.value[chatId] ?? []
  }

  function getTopic(chatId: string, topicId: string | undefined) {
    if (!topicId) {
      return undefined
    }

    return getTopics(chatId).find(topic => topic.topicId === topicId)
  }

  function fetchTopics(chatId: string, options: { force?: boolean } = {}) {
    if (!options.force && fetchedChatIds.value[chatId]) {
      return
    }

    bridge.sendEvent(CoreEventType.DialogTopicsFetch, { chatId })
  }

  return {
    all: computed(() => topicsByChatId.value),
    setTopics,
    getTopic,
    getTopics,
    fetchTopics,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChatTopicsStore, import.meta.hot))
}
