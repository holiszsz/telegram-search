export interface CoreChatTopic {
  chatId: string
  topicId: string
  title: string
  iconColor?: number
  iconEmojiId?: string
  topMessageId?: string
  unreadCount?: number
  lastReadInboxMsgId?: string
  lastReadOutboxMsgId?: string
  lastMessageDate?: number
  pinned?: boolean
  closed?: boolean
  hidden?: boolean
}
