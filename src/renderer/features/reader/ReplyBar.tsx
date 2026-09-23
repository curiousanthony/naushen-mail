import { CornerUpLeft, CornerUpRight, ReplyAll } from 'lucide-react'
import { useApp } from '@/lib/store'

export type ReplyMode = 'reply' | 'replyAll' | 'forward'

interface Props {
  threadId: string
  /** Last message in the thread — what a reply is addressed to. */
  messageId: string
  /** Hidden while the inline composer for this thread is open. */
  hidden?: boolean
}

/**
 * Reply / Reply all / Forward.
 *
 * Opens an *inline* composer: the compose feature renders it into
 * `#reader-inline-compose-slot` at the bottom of the thread. This component only asks.
 */
export function ReplyBar({ threadId, messageId, hidden }: Props): JSX.Element | null {
  const openComposer = useApp((s) => s.openComposer)
  if (hidden) return null

  const open = (mode: ReplyMode): void => {
    openComposer({ mode, threadId, messageId, placement: 'inline' })
  }

  return (
    <div className="replybar">
      <button className="replybar__btn" onClick={() => open('reply')}>
        <CornerUpLeft size={15} aria-hidden /> Reply <span className="replybar__key">r</span>
      </button>
      <button className="replybar__btn" onClick={() => open('replyAll')}>
        <ReplyAll size={15} aria-hidden /> Reply all <span className="replybar__key">a</span>
      </button>
      <button className="replybar__btn" onClick={() => open('forward')}>
        <CornerUpRight size={15} aria-hidden /> Forward <span className="replybar__key">f</span>
      </button>
    </div>
  )
}
