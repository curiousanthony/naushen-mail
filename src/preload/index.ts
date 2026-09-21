import { contextBridge, ipcRenderer } from 'electron'
import type { RendererBridge } from '@shared/api'

const bridge: RendererBridge = {
  invoke: ((method: string, ...args: unknown[]) => ipcRenderer.invoke(`api:${method}`, ...args)) as RendererBridge['invoke'],
  onEvent: (cb) => {
    const h = (_: unknown, e: Parameters<typeof cb>[0]): void => cb(e)
    ipcRenderer.on('event', h)
    return () => ipcRenderer.removeListener('event', h)
  },
  onMenuCommand: (cb) => {
    const h = (_: unknown, c: string): void => cb(c)
    ipcRenderer.on('menu', h)
    return () => ipcRenderer.removeListener('menu', h)
  }
}
contextBridge.exposeInMainWorld('api', bridge)
