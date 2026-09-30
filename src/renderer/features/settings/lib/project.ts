import { useEffect, useState } from 'react'
import { OUTLOOK_ENABLED } from '@shared/features'

export const REPO = 'https://github.com/curiousanthony/naushen-mail'
export const docUrl = (file: string): string => `${REPO}/blob/main/docs/${file}`
export const ISSUES_URL = `${REPO}/issues`
export const LICENSE_ID = 'FSL-1.1-Apache-2.0'

/**
 * i18n context for copy that names the providers: with Outlook hidden the `_outlook` keys (which say
 * "Gmail or Outlook") are skipped and the plain key (Gmail only) is used.
 */
export const providerCtx: { context?: string } = OUTLOOK_ENABLED ? { context: 'outlook' } : {}

/** `app.platform` result. `builtInOAuth` is added to the contract by the main-process work; read it defensively. */
export interface PlatformInfo {
  platform: string
  version: string
  builtInOAuth?: { google?: boolean }
}

let cached: Promise<PlatformInfo | null> | null = null
/** One `app.platform` call per session; resolves to null when it fails. */
export function getPlatformInfo(): Promise<PlatformInfo | null> {
  cached ??= window.api.invoke('app.platform').then((r) => r as PlatformInfo).catch(() => null)
  return cached
}

export function usePlatformInfo(): PlatformInfo | null {
  const [info, setInfo] = useState<PlatformInfo | null>(null)
  useEffect(() => {
    let live = true
    void getPlatformInfo().then((r) => { if (live) setInfo(r) })
    return () => { live = false }
  }, [])
  return info
}

export const hasBuiltInGoogle = (info: PlatformInfo | null | undefined): boolean => !!info?.builtInOAuth?.google

/** Key under `settings:store.*` naming where account tokens are kept on this platform. */
export const storeKey = (platform: string | undefined): 'darwin' | 'win32' | 'linux' =>
  platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux'

export const platformName = (platform: string | undefined): string =>
  platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform ?? ''
