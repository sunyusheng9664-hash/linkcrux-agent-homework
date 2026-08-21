import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { assertProductionBuildMode } from './scripts/productionBuildGuard'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const offlineDelivery = env.VITE_OFFLINE_DELIVERY === 'true'
  assertProductionBuildMode(command, env.VITE_API_MODE, env.VITE_OFFLINE_DELIVERY, mode)

  return {
    base: offlineDelivery ? './' : undefined,
    plugins: [react()],
    // Keep an ESM bundle: Vite's IIFE transform rewrites import.meta in React
    // Router and creates an invalid offline artifact. The post-build script
    // inlines this single module into index.html, which file:// can execute.
    build: offlineDelivery ? { rollupOptions: { output: { inlineDynamicImports: true, format: 'es' } } } : undefined,
  }
})
