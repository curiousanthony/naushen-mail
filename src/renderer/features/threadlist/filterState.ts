import { create } from 'zustand'
import { activeCount, type FilterCondition } from '@shared/filters'

/**
 * The thread list's active filter conditions. Lives in its own tiny store (not the app store)
 * so `lib/store.ts` can read it when it queries SQLite (`refreshThreads`) without the app store
 * having to know anything about filter UI. The Filter bar writes here, then asks the app store
 * to refetch; nav and account changes clear it (see `setNav` / `setAccount`).
 */
interface FilterState {
  conditions: FilterCondition[]
}

export const useFilters = create<FilterState>(() => ({ conditions: [] }))

export const setConditions = (conditions: FilterCondition[]): void => useFilters.setState({ conditions })
export const clearConditions = (): void => { if (useFilters.getState().conditions.length) useFilters.setState({ conditions: [] }) }
export const activeFilterCount = (): number => activeCount(useFilters.getState().conditions)
