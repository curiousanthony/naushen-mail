import type { AppSettings } from '@shared/types'

/** Appearance: show the current list count beside the view title. Default off. Persisted via settings.set (unknown keys are kept). */
export const readShowListCount = (s: AppSettings): boolean => (s as unknown as { showListCount?: unknown }).showListCount === true
export const showListCountPatch = (v: boolean): Partial<AppSettings> => ({ showListCount: v }) as unknown as Partial<AppSettings>
