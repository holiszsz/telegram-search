import type { CoreChatTopic } from '@tg-search/core/types'

import { CoreEventType } from '@tg-search/core'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatTopicsStore } from '../useChatTopics'
import { useSessionStore } from '../useSession'

const sendEventMock = vi.fn()
vi.mock('../../composables/useBridge', () => ({
  useBridge: () => ({
    sendEvent: sendEventMock,
  }),
}))

function createTopic(topicId: string, title: string): CoreChatTopic {
  return {
    chatId: 'chat-1',
    topicId,
    title,
  }
}

describe('useChatTopicsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('scopes topics and fetched markers by active session', () => {
    const sessionStore = useSessionStore()
    sessionStore.sessions = {
      sessionA: { uuid: 'sessionA' },
      sessionB: { uuid: 'sessionB' },
    }
    sessionStore.activeSessionId = 'sessionA'

    const topicsStore = useChatTopicsStore()
    topicsStore.setTopics('chat-1', [createTopic('alpha', 'Alpha')])
    topicsStore.fetchTopics('chat-1')

    expect(sendEventMock).not.toHaveBeenCalled()
    expect(topicsStore.getTopics('chat-1').map(topic => topic.topicId)).toEqual(['alpha'])

    sessionStore.activeSessionId = 'sessionB'

    // Topic read state is account-scoped, so switching accounts must not reuse
    // the previous account's fetched marker or topic list.
    expect(topicsStore.getTopics('chat-1')).toEqual([])

    topicsStore.fetchTopics('chat-1')

    expect(sendEventMock).toHaveBeenCalledWith(CoreEventType.DialogTopicsFetch, { chatId: 'chat-1' })
  })
})
