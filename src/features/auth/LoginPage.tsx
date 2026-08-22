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

  const isDemo = import.meta.env.VITE_API_MODE === 'mock' || import.meta.env.VITE_OFFLINE_DELIVERY === 'true'

  return <main className="auth-page">
    <form className="panel form" onSubmit={submit}>
      <header className="auth-header">
        <h1>客诉闭环 Agent</h1>
        <p>岗位级 AI 数智员工 · 质量经理工作台</p>
      </header>
      {isDemo && <div className="auth-demo-hint" role="note">
        <strong>当前为本地验收 / Demo 模式</strong>
        默认账号 linghe，默认密码 shuzhi。
      </div>}
      <label htmlFor="username">用户名</label>
      <input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
      <label htmlFor="password">密码</label>
      <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>{submitting ? <><span className="spinner" />登录中…</> : '登录'}</button>
    </form>
  </main>
}
