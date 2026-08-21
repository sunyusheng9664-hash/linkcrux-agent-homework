export function assertProductionBuildMode(command: 'serve' | 'build', apiMode?: string, offlineDelivery?: string, mode?: string) {
  if (command === 'build' && apiMode === 'mock' && (offlineDelivery !== 'true' || mode !== 'offline')) {
    throw new Error('LOCAL_DEMO_BUILD_FORBIDDEN')
  }
}
