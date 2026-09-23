/**
 * Thread-row preview feature: hovering a row for a moment shows a floating card, built from data
 * already loaded into the thread-list store, that tracks the cursor — see PreviewHost.tsx /
 * previewStore.ts for how the pieces fit together.
 */
export { PreviewHost } from './PreviewHost'
export { usePreviewStore } from './previewStore'
export { computePreviewPosition, SHOW_DELAY_MS } from './position'
