import type { Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { performSteps } from '@/features/commands/runner'
import { planMove, skippedNote, type Dest, type MovePlan } from './plan'

/**
 * Move conversations to a destination as one undoable step (toast Undo / `z`). Shared by the
 * sidebar drop targets and the `v` picker so both behave identically. Resolves to the plan that
 * ran (empty `apply` = nothing to do, nothing was touched).
 */
export async function moveThreads(threads: Thread[], dest: Dest): Promise<MovePlan> {
  const s = useApp.getState()
  const navRole = s.nav.kind === 'role' ? s.nav.role : null
  const plan = planMove(threads, dest, s.labels, navRole)
  if (!plan.apply.length) return plan
  await performSteps(plan.steps, skippedNote(plan, dest))
  void useApp.getState().refreshThreads()
  return plan
}
