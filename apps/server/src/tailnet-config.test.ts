import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const compose = readFileSync(
  new URL('../../../docker/docker-compose.yml', import.meta.url),
  'utf8',
)
const composeLines = compose.split('\n')

function serviceBlock(name: string): string {
  const start = composeLines.findIndex(line => line === `  ${name}:`)
  const end = composeLines.findIndex(
    (line, index) => index > start && (
      line === 'volumes:'
      || (line.startsWith('  ') && !line.startsWith('    ') && line.endsWith(':'))
    ),
  )

  expect(start, `missing ${name} service`).toBeGreaterThanOrEqual(0)
  return composeLines.slice(start, end === -1 ? undefined : end).join('\n')
}

describe('tailnet container boundaries', () => {
  it('publishes the app and PostgreSQL only on loopback', () => {
    expect(serviceBlock('app')).toContain('- \'127.0.0.1:3333:3333\'')
    expect(serviceBlock('pgvector')).toContain('- \'127.0.0.1:5435:5432\'')
  })

  it('does not publish MinIO ports to the host', () => {
    expect(serviceBlock('minio').split('\n')).not.toContain('    ports:')
  })

  it('does not retain wildcard app or PostgreSQL mappings', () => {
    const portMappings = composeLines
      .map(line => line.trim())
      .filter(line => line.startsWith('- '))
      .map(line => line.slice(2).replaceAll('\'', '').replaceAll('"', ''))

    expect(portMappings).not.toContain('3333:3333')
    expect(portMappings).not.toContain('5435:5432')
  })
})
