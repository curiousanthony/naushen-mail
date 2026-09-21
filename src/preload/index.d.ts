import type { RendererBridge } from '@shared/api'
declare global { interface Window { api: RendererBridge } }
export {}
