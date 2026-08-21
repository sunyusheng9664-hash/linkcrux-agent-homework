import { describe, expect, it } from 'vitest'

import { findSecretFindings } from './check-secrets.mjs'

describe('secret scanner', () => {
  it('rejects cloud credentials, non-placeholder API assignments, private keys and bearer tokens', () => {
    const samples = [
      ['AK', 'ID', '1234567890abcdefghijklmnop'].join(''),
      ['LLM_API_KEY', '=live-value-1234567890'].join(''),
      ['SecretKey', '=secret-value-1234567890'].join(''),
      ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
      ['Bearer', ' abcdefghijklmnopqrstuvwxyz123456'].join(''),
    ]

    for (const content of samples) {
      expect(findSecretFindings('unsafe.txt', content), content).not.toHaveLength(0)
    }
    const unsafeJson = ['{"', 'LLM_API_KEY', '":"', 'live-value-1234567890', '"}'].join('')
    expect(findSecretFindings('unsafe.json', unsafeJson)).not.toHaveLength(0)
    const credentialKeys = [
      ['OPENAI', 'API', 'KEY'].join('_'),
      ['LLM', 'SECRET', 'KEY'].join('_'),
      ['CLIENT', 'SECRET'].join('_'),
      ['SERVICE', 'ACCESS', 'TOKEN'].join('_'),
      ['AWS', 'ACCESS', 'KEY', 'ID'].join('_'),
    ]
    for (const key of credentialKeys) {
      expect(findSecretFindings('unsafe.env', `${key}=live-value-1234567890`), key).not.toHaveLength(0)
      expect(findSecretFindings('unsafe.json', `{"${key}":"live-value-1234567890"}`), key).not.toHaveLength(0)
      expect(findSecretFindings('unsafe.js', `const ${key} = "live-value-1234567890"`), key).not.toHaveLength(0)
    }
    const encryptedPrivateKey = ['-----BEGIN ', 'ENCRYPTED PRIVATE KEY-----'].join('')
    expect(findSecretFindings('unsafe.pem', encryptedPrivateKey)).not.toHaveLength(0)
    const dsaPrivateKey = ['-----BEGIN ', 'DSA PRIVATE KEY-----'].join('')
    expect(findSecretFindings('unsafe.pem', dsaPrivateKey)).not.toHaveLength(0)
    const backtickLiteral = [credentialKeys[0], ' = ', '`', 'live-value-1234567890', '`'].join('')
    expect(findSecretFindings('unsafe.js', backtickLiteral)).not.toHaveLength(0)
    expect(findSecretFindings('dist/assets/app.js', 'const demoPassword = "shuzhi"')).not.toHaveLength(0)
  })

  it('allows documented placeholders, variable names and inert test fragments', () => {
    const safe = [
      'LLM_API_KEY=replace-in-cloudbase-console',
      'LLM_BASE_URL=https://your-provider.example/v1',
      'VITE_CLOUDBASE_ENV_ID=your-cloudbase-env-id',
      'const apiKeyName = "LLM_API_KEY"',
      "['AK', 'ID'].join('')",
      'Authorization: Bearer ${token}',
    ].join('\n')

    expect(findSecretFindings('.env.example', safe)).toEqual([])
    expect(findSecretFindings('safe.json', '{"LLM_API_KEY":"replace-in-cloudbase-console"}')).toEqual([])
    expect(findSecretFindings('dist/assets/vendor.js', 'const config={API_KEY:runtimeConfig.apiKey}')).toEqual([])
    const openAiKey = ['OPENAI', 'API', 'KEY'].join('_')
    expect(findSecretFindings('safe.env', `${openAiKey}=\${${openAiKey}}`)).toEqual([])
    expect(findSecretFindings('safe.json', `{"${openAiKey}":"replace-in-runtime"}`)).toEqual([])
    expect(findSecretFindings('safe.js', `const config={${openAiKey}:runtimeConfig.apiKey}`)).toEqual([])
    const backtickReference = [openAiKey, ' = ', '`', '${runtimeConfig.apiKey}', '`'].join('')
    expect(findSecretFindings('safe.js', backtickReference)).toEqual([])
    const symbolicClientSecret = ['CLIENT_SECRET', ' = ', '`', 'client_secret', '`'].join('')
    expect(findSecretFindings('dist/assets/vendor.js', symbolicClientSecret)).toEqual([])
    const proseVariableMention = ['`LLM_API_KEY=', '` 非空值；`SecretKey', '` 为变量名。'].join('')
    expect(findSecretFindings('docs/guide.md', proseVariableMention)).toEqual([])
  })
})
