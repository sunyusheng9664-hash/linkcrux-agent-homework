import { useState, type FormEvent } from 'react'

import type { AuthService } from '../../services/cloudbase'

export function LoginPage({ auth, onSignedIn }: { auth: Pick<AuthService, 'signIn'>; onSignedIn?: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setSubmitting(true)
    try {
      await auth.signIn(username, password)
      onSignedIn?.()
    } catch {
      setError('登录失败，请检查用户名和密码')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="auth-page"><form className="panel form" onSubmit={submit}>
    <h1>品质客诉 Agent</h1><p>质量经理工作台</p>
    <label htmlFor="username">用户名</label>
    <input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
    <label htmlFor="password">密码</label>
    <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={submitting}>{submitting ? '登录中…' : '登录'}</button>
  </form></main>
}
