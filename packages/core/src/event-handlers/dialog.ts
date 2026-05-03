import type { Logger } from '@guiiai/logg'

import type { CoreContext } from '../context'
import type { Models } from '../models'
import type { DialogService } from '../services'
import type { CoreDialog } from '../types/dialog'

import { CoreEventType } from '../types/events'
import { syncTopicsAndAttachRoots } from './utils/sync-topics'

async function fetchTopicsForDialog(
  ctx: CoreContext,
  logger: Logger,
  dbModels: Models,
  dialogService: DialogService,
  dialog: Pick<CoreDialog, 'id' | 'accessHash' | 'isForum'>,
) {
  if (!dialog.isForum) {
    return
  }

  const chatId = String(dialog.id)
  if (!dialog.accessHash) {
    logger.withFields({ chatId }).warn('Cannot fetch forum topics without access hash')
    return
  }

  const topics = (await dialogService.fetchTopics(chatId, dialog.accessHash)).orUndefined()
  if (!topics) {
    return
  }

  const accountId = ctx.getCurrentAccountId()
  const recordedTopics = await syncTopicsAndAttachRoots(ctx.getDB(), chatId, accountId, topics, dbModels)
  ctx.emitter.emit(CoreEventType.DialogTopicsData, { chatId, topics: recordedTopics })
}

async function fetchAllForumTopics(
  ctx: CoreContext,
  logger: Logger,
  dbModels: Models,
  dialogService: DialogService,
  dialogs: CoreDialog[],
) {
  for (const dialog of dialogs.filter(dialog => dialog.isForum)) {
    try {
      await fetchTopicsForDialog(ctx, logger, dbModels, dialogService, dialog)
    }
    catch (error) {
      logger.withFields({ chatId: dialog.id }).withError(error).warn('Failed to sync forum topics')
    }
  }
}

export async function fetchDialogs(ctx: CoreContext, logger: Logger, dbModels: Models, dialogService: DialogService) {
  logger.verbose('Fetching dialogs')

  const dialogs = (await dialogService.fetchDialogs()).expect('Failed to fetch dialogs')
  const pinnedDialogIds = (await dialogService.fetchPinnedDialogIds(0)).orUndefined() ?? []

  // Get current account ID from context
  const accountId = ctx.getCurrentAccountId()

  // Enrich dialogs with folderIds from DB if available
  const dbChats = (await dbModels.chatModels.fetchChatsByAccountId(ctx.getDB(), accountId)).orUndefined()
  if (dbChats) {
    for (const dialog of dialogs) {
      const dbChat = dbChats.find(c => c.chat_id === String(dialog.id))
      if (dbChat) {
        dialog.folderIds = dbChat.folder_ids ?? []
      }
      else {
        dialog.folderIds = []
      }
    }
  }
  else {
    // Ensure folderIds is at least an empty array
    for (const dialog of dialogs) {
      dialog.folderIds = []
    }
  }

  ctx.emitter.emit(CoreEventType.DialogData, { dialogs, pinnedDialogIds })
  ctx.emitter.emit(CoreEventType.StorageRecordDialogs, { dialogs, accountId })
  await fetchAllForumTopics(ctx, logger, dbModels, dialogService, dialogs)
}

export function registerDialogEventHandlers(ctx: CoreContext, logger: Logger, dbModels: Models) {
  logger = logger.withContext('core:dialog:event')

  return (dialogService: DialogService) => {
    ctx.emitter.on(CoreEventType.DialogFetch, async () => {
      await fetchDialogs(ctx, logger, dbModels, dialogService)
    })

    ctx.emitter.on(CoreEventType.DialogFoldersFetch, async () => {
      logger.verbose('Fetching chat folders')

      const folders = (await dialogService.fetchChatFolders()).expect('Failed to fetch chat folders')
      const accountId = ctx.getCurrentAccountId()

      ctx.emitter.emit(CoreEventType.StorageRecordChatFolders, { folders, accountId })
    })

    ctx.emitter.on(CoreEventType.DialogTopicsFetch, async ({ chatId }) => {
      logger.withFields({ chatId }).verbose('Fetching forum topics')
      const accountId = ctx.getCurrentAccountId()
      const hasAccess = (await dbModels.chatModels.isChatAccessibleByAccount(ctx.getDB(), accountId, chatId)).expect('Failed to check chat access')

      if (!hasAccess) {
        ctx.withError('Unauthorized chat access', 'Account does not have access to requested chat topics')
        return
      }

      const chatAccess = (await dbModels.chatModels.findChatAccessHash(ctx.getDB(), accountId, chatId)).expect('Failed to resolve chat access hash')
      if (!chatAccess?.accessHash) {
        ctx.withError('Missing chat access hash', 'Cannot fetch forum topics without a stored access hash')
        return
      }

      const topics = (await dialogService.fetchTopics(chatId, chatAccess.accessHash)).expect('Failed to fetch forum topics')
      const recordedTopics = await syncTopicsAndAttachRoots(ctx.getDB(), chatId, accountId, topics, dbModels)
      ctx.emitter.emit(CoreEventType.DialogTopicsData, { chatId, topics: recordedTopics })
    })

    // Prioritized single-avatar fetch for viewport-visible items
    ctx.emitter.on(CoreEventType.DialogAvatarFetch, async ({ chatId }) => {
      logger.withFields({ chatId }).verbose('Fetching single dialog avatar')
      await dialogService.fetchSingleDialogAvatar(String(chatId))
    })
  }
}
