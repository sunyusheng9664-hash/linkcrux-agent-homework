import { RouterProvider } from 'react-router-dom'

import { createLocalDemoServices } from '../services/localDemoRuntime'
import { createAppRouter } from './router'

export function LocalDemoApp() {
  const services = createLocalDemoServices()
  const router = createAppRouter({ ...services, offline: import.meta.env.VITE_OFFLINE_DELIVERY === 'true' })
  return <>
    <aside className="demo-notice" role="status">
      <strong>本地验收模式 / Demo 模拟</strong>
      <span>本地 Demo 模拟结果，不代表真实模型或 CloudBase 已验收。</span>
    </aside>
    <RouterProvider router={router} />
  </>
}
