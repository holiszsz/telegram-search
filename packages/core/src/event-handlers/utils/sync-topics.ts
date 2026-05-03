import type { CoreDB } from '../../db'
import type { Models } from '../../models'
import type { CoreChatTopic } from '../../types/topic'

export async function syncTopicsAndAttachRoots(
  db: CoreDB,
  chatId: string,
  accountId: string,
  topics: CoreChatTopic[],
  dbModels: Models,
): Promise<CoreChatTopic[]> {
  const recordedTopics = await dbModels.chatTopicModels.recordTopics(db, topics, 'telegram', accountId)

  const assignments = recordedTopics
    .filter(topic => topic.topMessageId)
    .map(topic => ({ rootMessageId: topic.topMessageId!, topicId: topic.topicId }))

  if (assignments.length > 0) {
    (await dbModels.chatMessageModels.assignTopicForRootMessages(db, chatId, assignments))
      .expect('Failed to assign topic for root messages')
  }

  return recordedTopics
}
