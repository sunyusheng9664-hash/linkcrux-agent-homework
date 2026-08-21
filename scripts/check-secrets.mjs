#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage', 'playwright-report', 'test-results'])
const CREDENTIAL_KEY_SOURCE = String.raw`(?:[A-Z][A-Z0-9]*_)*(?:API_KEY|SECRET_KEY|CLIENT_SECRET|ACCESS_TOKEN|ACCESS_KEY(?:_ID)?)|SecretKey`

export function findSecretFindings(filePath, content) {
  const findings = []
  const add = (rule) => {
    if (!findings.some((finding) => finding.rule === rule)) findings.push({ filePath, rule })
  }

  if (/AKID[A-Za-z0-9]{16,}/g.test(content)) add('tencent-access-key-id')
  if (/-----BEGIN DSA PRIVATE KEY-----/g.test(content)) add('private-key-block')
  if (/-----BEGIN (?:(?:RSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----/g.test(content)) add('private-key-block')

  const bearerPattern = /\bBearer\s+([^\s"'`,;]+)/gi
  for (const match of content.matchAll(bearerPattern)) {
    if (isCredentialValue(match[1]) && match[1].length >= 20) add('bearer-token')
  }

  const quotedAssignmentPattern = new RegExp(`["']?\\b(${CREDENTIAL_KEY_SOURCE})\\b["']?\\s*[:=]\\s*(["'])(.*?)\\2`, 'gi')
  for (const match of content.matchAll(quotedAssignmentPattern)) {
    if (isCredentialValue(match[3])) add('non-placeholder-secret-assignment')
  }
  const backtick = String.fromCharCode(96)
  const backtickAssignmentPattern = new RegExp(`\\b(${CREDENTIAL_KEY_SOURCE})\\b\\s*[:=]\\s*${backtick}(.*?)${backtick}`, 'gi')
  for (const match of content.matchAll(backtickAssignmentPattern)) {
    if (isCredentialValue(match[2])) add('non-placeholder-secret-assignment')
  }
  const envAssignmentPattern = new RegExp(`^\\s*(?:export\\s+)?(${CREDENTIAL_KEY_SOURCE})\\s*=\\s*([^\\s#]+)`, 'gim')
  for (const match of content.matchAll(envAssignmentPattern)) {
    if (isCredentialValue(match[2])) add('non-placeholder-secret-assignment')
  }

  if (isFrontendBuildPath(filePath) && content.includes('shuzhi')) add('local-demo-password-in-production-bundle')
  return findings
}

export function collectCandidateFiles(root = ROOT) {
  const candidates = new Set()
  try {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    for (const path of tracked.split('\0')) if (path) candidates.add(resolve(root, path))
  } catch {
    // The explicit source/build roots below still provide a useful scan outside Git.
  }

  for (const scanRoot of [resolve(root, 'src'), resolve(root, 'dist'), resolve(root, 'cloudfunctions')]) {
    walk(scanRoot, candidates, scanRoot.endsWith('cloudfunctions'))
  }
  return [...candidates].sort()
}

function walk(path, candidates, cloudfunctionsOnlyDist = false) {
  if (!existsSync(path)) return
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return
  if (stat.isFile()) {
    candidates.add(path)
    return
  }
  if (!stat.isDirectory() || SKIPPED_DIRECTORIES.has(path.split('/').at(-1))) return
  for (const entry of readdirSync(path)) {
    const child = resolve(path, entry)
    if (cloudfunctionsOnlyDist && !child.includes('/dist/') && !child.endsWith('/dist') && lstatSync(child).isFile()) continue
    walk(child, candidates, cloudfunctionsOnlyDist)
  }
}

function isCredentialValue(value) {
  const normalized = value.trim().replace(/^['"\x60]|['"\x60]$/g, '')
  if (!normalized) return false
  if (/[\u3400-\u9fff]/u.test(normalized)) return false
  if (/^(?:client_secret|access_token|api_key|secret_key|private_key|oauth_token)$/i.test(normalized)) return false
  if (/^(?:\$\{|<|your-|replace-|placeholder|example|changeme|test-fixture|dummy)/i.test(normalized)) return false
  if (normalized.includes('${') || normalized.includes('process.env') || normalized.includes('import.meta.env')) return false
  return true
}

function isFrontendBuildPath(path) {
  const normalized = path.replaceAll('\\', '/')
  return normalized === 'dist' || normalized.startsWith('dist/') || normalized.includes('/dist/assets/')
}

function scanRepository(root = ROOT) {
  const findings = []
  for (const absolutePath of collectCandidateFiles(root)) {
    let content
    try {
      const buffer = readFileSync(absolutePath)
      if (buffer.includes(0)) continue
      content = buffer.toString('utf8')
    } catch {
      continue
    }
    findings.push(...findSecretFindings(relative(root, absolutePath), content))
  }
  return findings
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const findings = scanRepository()
  if (findings.length > 0) {
    console.error('Secret scan failed:')
    for (const finding of findings) console.error(`- ${finding.filePath}: ${finding.rule}`)
    process.exitCode = 1
  } else {
    console.log('Secret scan passed.')
  }
}
