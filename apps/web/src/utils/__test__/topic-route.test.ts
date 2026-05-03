import { describe, expect, it } from 'vitest'

import { decodeTopicQuery, encodeTopicForUrl } from '../topic-route'

describe('topic route helpers', () => {
  it('decodes topic query values', () => {
    expect(decodeTopicQuery('general')).toBe('')
    expect(decodeTopicQuery(undefined)).toBeUndefined()
    expect(decodeTopicQuery('123')).toBe('123')
    expect(decodeTopicQuery('')).toBeUndefined()
  })

  it('encodes the General topic for URLs', () => {
    expect(encodeTopicForUrl('')).toBe('general')
    expect(encodeTopicForUrl('123')).toBe('123')
  })
})
