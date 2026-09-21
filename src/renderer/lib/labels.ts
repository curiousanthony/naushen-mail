import type { LabelColor } from '@shared/types'
export const chipStyle = (c?: LabelColor): { color: string; background: string } => ({
  color: `var(--chip-${c ?? 'gray'}-fg)`, background: `var(--chip-${c ?? 'gray'}-bg)`
})
