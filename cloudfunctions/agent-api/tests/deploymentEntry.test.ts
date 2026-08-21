import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('deployment entrypoint', () => {
  it('exports the compiled cloud function main from the package root', async () => {
    const entry = await import('../index.js')

    expect(entry.main).toBeTypeOf('function')
  })

  it('keeps the cold-start entrypoint lightweight and loads the compiled handler on invocation', async () => {
    const source = await readFile('cloudfunctions/agent-api/index.js', 'utf8')

    expect(source).toContain('exports.main = async')
    expect(source).toContain("require('./dist/index.js')")
  })

  it('declares the PDF text parser in the deployable cloud-function package', async () => {
    const packageJson = JSON.parse(await readFile('cloudfunctions/agent-api/package.json', 'utf8')) as {
      dependencies?: Record<string, string>
    }

    expect(packageJson.dependencies?.['pdf-parse']).toBeDefined()
  })

  it('declares the knowledge search runtime in the deployable cloud-function package', async () => {
    const packageJson = JSON.parse(await readFile('cloudfunctions/agent-api/package.json', 'utf8')) as {
      dependencies?: Record<string, string>
    }

    expect(packageJson.dependencies?.minisearch).toBeDefined()
  })

  it('declares a Node runtime compatible with the PDF parser in the deployable package', async () => {
    const packageJson = JSON.parse(await readFile('cloudfunctions/agent-api/package.json', 'utf8')) as { engines?: { node?: string } }

    expect(packageJson.engines?.node).toBe('^20.19.0 || >=22.12.0')
  })
})
