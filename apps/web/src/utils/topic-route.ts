export const GENERAL_TOPIC_URL_TOKEN = 'general'
export const GENERAL_TOPIC_DB_VALUE = ''

export function decodeTopicQuery(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }

  if (raw === GENERAL_TOPIC_URL_TOKEN) {
    return GENERAL_TOPIC_DB_VALUE
  }

  return raw === '' ? undefined : raw
}

export function encodeTopicForUrl(topicId: string): string {
  return topicId === GENERAL_TOPIC_DB_VALUE ? GENERAL_TOPIC_URL_TOKEN : topicId
}
