import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import type { AuthService } from '../../services/cloudbase'

export function AuthGuard({ auth, children }: { auth: Pick<AuthService, 'isSignedIn'>; children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean>()
  useEffect(() => { void auth.isSignedIn().then(setSignedIn).catch(() => setSignedIn(false)) }, [auth])
  if (signedIn === undefined) return <p role="status">正在确认登录状态…</p>
  return signedIn ? <>{children}</> : <Navigate to="/login" replace />
}
