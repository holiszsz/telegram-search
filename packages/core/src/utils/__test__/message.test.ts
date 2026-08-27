import { Api } from 'telegram'
import { describe, expect, it } from 'vitest'

import { extractMessageEntityUrls } from '../message'

describe('extractMessageEntityUrls', () => {
  it('extracts hidden and visible HTTP URLs in Telegram entity order', () => {
    const content = '来源 查看来源 https://example.com/visible'
    const visibleUrl = 'https://example.com/visible'
    const visibleOffset = content.indexOf(visibleUrl)

    const urls = extractMessageEntityUrls({
      message: content,
      entities: [
        new Api.MessageEntityTextUrl({ offset: 3, length: 4, url: 'https://example.com/hidden' }),
        new Api.MessageEntityUrl({ offset: visibleOffset, length: visibleUrl.length }),
      ],
    })

    expect(urls).toEqual([
      'https://example.com/hidden',
      'https://example.com/visible',
    ])
  })

  it('uses Telegram UTF-16 offsets for visible URLs after emoji', () => {
    const content = '🚀 https://example.com/emoji'
    const visibleUrl = 'https://example.com/emoji'

    const urls = extractMessageEntityUrls({
      message: content,
      entities: [
        new Api.MessageEntityUrl({ offset: 3, length: visibleUrl.length }),
      ],
    })

    expect(urls).toEqual([visibleUrl])
  })

  it('rejects non-HTTP links and de-duplicates without reordering', () => {
    const urls = extractMessageEntityUrls({
      message: 'links',
      entities: [
        new Api.MessageEntityTextUrl({ offset: 0, length: 1, url: 'tg://resolve?domain=test' }),
        new Api.MessageEntityTextUrl({ offset: 1, length: 1, url: 'https://example.com/source' }),
        new Api.MessageEntityTextUrl({ offset: 2, length: 1, url: 'https://example.com/source' }),
        new Api.MessageEntityTextUrl({ offset: 3, length: 1, url: 'not-a-url' }),
      ],
    })

    expect(urls).toEqual(['https://example.com/source'])
  })
})
