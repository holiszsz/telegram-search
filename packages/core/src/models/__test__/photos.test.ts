// eslint-disable-next-line unicorn/prefer-node-protocol
import { Buffer } from 'buffer'

import { v4 as uuidv4 } from 'uuid'
import { describe, expect, it } from 'vitest'

import { mockDB } from '../../db/mock'
import { accountsTable } from '../../schemas/accounts'
import { chatMessagesTable } from '../../schemas/chat-messages'
import { joinedChatsTable } from '../../schemas/joined-chats'
import { photosTable } from '../../schemas/photos'
import { usersTable } from '../../schemas/users'
import { photoModels } from '../photos'

async function setupDb() {
  return mockDB({
    accountsTable,
    joinedChatsTable,
    chatMessagesTable,
    photosTable,
    usersTable,
  })
}

describe('models/photos', () => {
  it('recordPhotos returns empty array when there is no media with bytes', async () => {
    const db = await setupDb()

    const resultEmpty = await photoModels.recordPhotos(db, [])
    expect(resultEmpty).toEqual([])

    const resultNoBytes = await photoModels.recordPhotos(db, [
      {
        uuid: uuidv4(),
        type: 'photo',
        platformId: 'file-1',
        messageUUID: uuidv4(),
      },
    ])

    expect(resultNoBytes).toEqual([])

    const all = await db.select().from(photosTable)
    expect(all).toHaveLength(0)
  })

  it('recordPhotos can persist external storage path without raw bytes and clears bytes on conflict', async () => {
    const db = await setupDb()

    const messageUUID = uuidv4()

    // First insert with inline bytes only.
    await photoModels.recordPhotos(db, [
      {
        uuid: uuidv4(),
        type: 'photo',
        platformId: 'file-external',
        messageUUID,
        byte: Buffer.from([1, 2, 3]),
        mimeType: 'image/jpeg',
      },
    ])

    let [row] = await db.select().from(photosTable)
    expect(row.image_bytes).toBeInstanceOf(Uint8Array)
    // Default path is an empty string when no external storage is used.
    expect(row.image_path).toBe('')

    // Second insert switches to external storage only (no inline bytes).
    await photoModels.recordPhotos(db, [
      {
        uuid: uuidv4(),
        type: 'photo',
        platformId: 'file-external',
        messageUUID,
        storagePath: 'photo/file-external',
        mimeType: 'image/jpeg',
      },
    ])

    ;[row] = await db.select().from(photosTable)

    // When using external storage, image_bytes should be cleared and image_path populated.
    expect(row.image_bytes).toBeNull()
    expect(row.image_path).toBe('photo/file-external')
    expect(row.image_mime_type).toBe('image/jpeg')
  })

  it('recordPhotos inserts new photos and updates on conflict', async () => {
    const db = await setupDb()

    const firstBytes = Buffer.from([1, 2, 3])
    const secondBytes = Buffer.from([9, 9, 9, 9])
    const messageUUID = uuidv4()

    const first = await photoModels.recordPhotos(db, [
      {
        uuid: uuidv4(),
        type: 'photo',
        platformId: 'file-1',
        messageUUID,
        byte: firstBytes,
        mimeType: 'image/jpeg',
      },
    ])

    const inserted = first
    expect(inserted).toHaveLength(1)
    expect(inserted[0].file_id).toBe('file-1')
    expect(inserted[0].image_mime_type).toEqual('image/jpeg')

    const second = await photoModels.recordPhotos(db, [
      {
        uuid: uuidv4(),
        type: 'photo',
        platformId: 'file-1',
        messageUUID,
        byte: secondBytes,
        mimeType: 'image/bmp',
      },
    ])

    const updated = second
    expect(updated).toHaveLength(1)

    const [photo] = await db.select().from(photosTable)
    expect(photo.image_bytes).toBeInstanceOf(Uint8Array)
    expect((photo.image_bytes as Uint8Array).length).toBe(secondBytes.length)
    expect(photo.image_mime_type).toEqual('image/bmp')
  })

  it('findPhotoByFileId and findPhotoByQueryId return the correct photo', async () => {
    const db = await setupDb()

    const [inserted] = await db.insert(photosTable).values({
      platform: 'telegram',
      file_id: 'file-42',
      message_id: uuidv4(),
      image_bytes: Buffer.from([1]),
      image_mime_type: 'image/jpeg',
    }).returning()

    const byFileId = (await photoModels.findPhotoByFileId(db, 'file-42')).unwrap()
    expect(byFileId.id).toBe(inserted.id)
    expect(byFileId.image_mime_type).toBe('image/jpeg')

    const byQueryId = (await photoModels.findPhotoByQueryId(db, inserted.id)).unwrap()
    expect(byQueryId.id).toBe(inserted.id)
    expect(byQueryId.image_mime_type).toBe('image/jpeg')
  })

  it('findPhotoByFileIdWithMimeType returns id and mimeType only', async () => {
    const db = await setupDb()

    const [inserted] = await db.insert(photosTable).values({
      platform: 'telegram',
      file_id: 'file-mime',
      image_mime_type: 'image/png',
    }).returning()

    const result = (await photoModels.findPhotoByFileIdWithMimeType(db, 'file-mime')).unwrap()

    expect(result.id).toBe(inserted.id)
    expect(result.mimeType).toBe('image/png')
  })

  it('findPhotosByMessageId(s) return all matching photos', async () => {
    const db = await setupDb()

    const messageUuid1 = uuidv4()
    const messageUuid3 = uuidv4()

    await db.insert(photosTable).values([
      {
        platform: 'telegram',
        file_id: 'file-a',
        message_id: messageUuid1,
        image_mime_type: 'image/jpeg',
      },
      {
        platform: 'telegram',
        file_id: 'file-b',
        message_id: messageUuid1,
        image_mime_type: 'image/jpeg',
      },
      {
        platform: 'telegram',
        file_id: 'file-c',
        message_id: messageUuid3,
        image_mime_type: 'image/jpeg',
      },
    ])

    const forMsg1 = (await photoModels.findPhotosByMessageId(db, messageUuid1)).unwrap()
    expect(forMsg1.map(p => p.file_id).sort()).toEqual(['file-a', 'file-b'])

    const forBoth = (await photoModels.findPhotosByMessageIds(db, [
      messageUuid1,
      messageUuid3,
    ])).unwrap()
    expect(forBoth.map(p => p.file_id).sort()).toEqual(['file-a', 'file-b', 'file-c'])
  })

  it('searchPhotosByText treats an empty topicId as the General topic filter', async () => {
    const db = await setupDb()

    const [chat] = await db.insert(joinedChatsTable).values({
      platform: 'telegram',
      chat_id: 'forum-photos',
      chat_name: 'Forum Photos',
      chat_type: 'supergroup',
      is_forum: true,
    }).returning()

    const [generalMessage, topicMessage] = await db.insert(chatMessagesTable).values([
      {
        platform: 'telegram',
        platform_message_id: '1',
        from_id: 'u1',
        from_name: 'User 1',
        in_chat_id: chat.chat_id,
        in_chat_type: 'supergroup',
        content: 'general photo',
        is_reply: false,
        reply_to_name: '',
        reply_to_id: '',
        platform_timestamp: 1000,
        created_at: 1000,
      },
      {
        platform: 'telegram',
        platform_message_id: '2',
        from_id: 'u1',
        from_name: 'User 1',
        in_chat_id: chat.chat_id,
        in_chat_type: 'supergroup',
        topic_id: 'alpha',
        content: 'topic photo',
        is_reply: false,
        reply_to_name: '',
        reply_to_id: '',
        platform_timestamp: 2000,
        created_at: 2000,
      },
    ]).returning()

    await db.insert(photosTable).values([
      {
        platform: 'telegram',
        file_id: 'general-photo',
        message_id: generalMessage.id,
        description: 'shared keyword',
        image_mime_type: 'image/jpeg',
      },
      {
        platform: 'telegram',
        file_id: 'topic-photo',
        message_id: topicMessage.id,
        description: 'shared keyword',
        image_mime_type: 'image/jpeg',
      },
    ])

    const results = (await photoModels.searchPhotosByText(db, 'shared', 10, {
      chatIds: [chat.chat_id],
      topicId: '',
    })).unwrap()

    expect(results.map(photo => photo.file_id)).toEqual(['general-photo'])
  })
})
