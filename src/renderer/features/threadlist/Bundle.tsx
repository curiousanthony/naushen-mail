import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronRight, Layers } from 'lucide-react'
import { listTime } from '@/lib/format'
import { Tooltip } from '@/features/tooltip'
import { perform } from '@/features/commands/runner'
import { toastText } from '@/features/commands/undo'
import { bundleCount, type BundleGroup } from './bundles'
import { useBundleUi } from './bundleNav'
import './bundles.css'

/**
 * One collapsed-or-open bundle in the inbox ("Newsletters · 7 new · The Sunday Digest, …").
 * Same geometry as a conversation row, so it lines up and the list's fixed-height windowing holds.
 * Members of an open bundle render as ordinary rows beneath it (see index.tsx).
 */
function BundleRowImpl({ bundle, expanded, focused }: {
  bundle: BundleGroup; expanded: boolean; focused: boolean
}): JSX.Element {
  const { t: tr } = useTranslation('threadlist')
  const toggle = useBundleUi((s) => s.toggle)
  const ids = bundle.threads.map((t) => t.id)
  const n = ids.length
  const label = tr('bundle.ariaLabel', { name: bundle.def.name, summary: bundleCount(bundle) })

  return (
    <div
      className="trow tbundle" role="option" aria-selected={false} aria-expanded={expanded} aria-label={label}
      data-bundle={bundle.def.id} data-unread={bundle.unread > 0} data-focused={focused} data-expanded={expanded}
      onClick={() => toggle(bundle.def.id)}
    >
      <span className="trow__lead">
        <span className="trow__unread" data-on={bundle.unread > 0} />
        <span className="tbundle__icon"><Layers size={13} strokeWidth={1.75} /></span>
      </span>

      <span className="trow__sender tbundle__name">{bundle.def.name}</span>

      <span className="trow__text">
        <span className="tbundle__count" data-new={bundle.unread > 0}>{bundleCount(bundle)}</span>
        {bundle.senders.length > 0 && <span className="trow__snippet">{bundle.senders.join(', ')}</span>}
      </span>

      <span className="trow__meta">
        <ChevronRight size={14} className="tbundle__chev" aria-hidden />
      </span>

      <span className="trow__right">
        <span className="trow__time">{listTime(bundle.newest)}</span>
        <span className="trow__actions">
          <Tooltip label={tr('bundle.archiveAll', { count: n })} shortcut="E">
            <button
              className="trow__act" aria-label={tr('bundle.archiveAllIn', { count: n, name: bundle.def.name })} tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); void perform({ type: 'archive' }, toastText('archive', n), { ids }) }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Archive size={14} />
            </button>
          </Tooltip>
        </span>
      </span>
    </div>
  )
}

export const BundleRow = memo(BundleRowImpl)
