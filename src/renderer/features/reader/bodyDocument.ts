/**
 * Builds the document shown inside the message iframe.
 *
 * Two things make this awkward and both are deliberate:
 *
 * 1. The iframe is a separate document, so `var(--c-text)` resolves to nothing inside it.
 *    Token values are read from the parent with `getComputedStyle` and interpolated as
 *    literals — `tokens.css` stays the single source of truth, and the document is rebuilt
 *    when the colour scheme changes.
 * 2. Dark mode is *not* applied by inverting. Mail that ships its own colours (every
 *    newsletter) is rendered on a light "paper" surface instead; only plain mail follows the
 *    app's dark tokens. Inverting designed HTML produces grey-on-grey mush.
 */

/** Token names read from the parent document, in the order used below. */
const TOKENS = [
  '--font-ui', '--font-mono',
  '--c-bg',
  '--c-text', '--c-text-2', '--c-text-3', '--c-accent', '--c-divider', '--c-border',
  '--c-bg-hover', '--c-bg-input',
  '--reader-paper-bg', '--reader-paper-text', '--reader-paper-text-2',
  '--reader-paper-divider', '--reader-paper-accent', '--reader-paper-fill'
] as const

export type ThemeTokens = Record<(typeof TOKENS)[number], string>

/** Snapshot the design tokens currently in force. */
export function readThemeTokens(): ThemeTokens {
  const cs = getComputedStyle(document.documentElement)
  const out = {} as ThemeTokens
  for (const name of TOKENS) out[name] = cs.getPropertyValue(name).trim()
  return out
}

export interface BodyDocumentOptions {
  /** Already sanitised markup. */
  html: string
  tokens: ThemeTokens
  /** App is currently rendering dark. */
  dark: boolean
  /** The mail sets its own colours, so keep it on a light surface. */
  paper: boolean
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/** The stylesheet injected above every message body. */
export function buildBodyCss(o: BodyDocumentOptions): string {
  const t = o.tokens
  const text = o.paper ? t['--reader-paper-text'] : t['--c-text']
  const muted = o.paper ? t['--reader-paper-text-2'] : t['--c-text-2']
  const divider = o.paper ? t['--reader-paper-divider'] : t['--c-divider']
  const accent = o.paper ? t['--reader-paper-accent'] : t['--c-accent']
  const fill = o.paper ? t['--reader-paper-fill'] : t['--c-bg-hover']
  const scheme = o.paper ? 'light' : o.dark ? 'dark' : 'light'
  /*
   * Named explicitly, never `transparent`: under `color-scheme: dark` a transparent root makes
   * the browser paint its own dark canvas (#121212), which reads as a panel against the app's
   * #191919. Matching the app token exactly makes the frame disappear.
   */
  const surface = o.paper ? t['--reader-paper-bg'] : t['--c-bg']

  return `
:root { color-scheme: ${scheme}; }
html, body { margin: 0; padding: 0; }
/*
 * Scrolling is owned by <html>, not <body>. If <body> carries the overflow it propagates to the
 * viewport, <body> stops being a block formatting context, and its scrollHeight then excludes
 * child margins — which is what the parent measures to size this frame. display:flow-root
 * makes <body> a BFC so its scrollHeight is the true content height.
 */
html { background: ${surface}; overflow-x: auto; overflow-y: hidden; }
body {
  display: flow-root;
  font-family: ${t['--font-ui']};
  font-size: 15px; line-height: 1.55; color: ${text}; background: ${surface};
  -webkit-font-smoothing: antialiased;
  overflow-wrap: break-word; word-break: break-word;
}
/* Fixed-width newsletter tables must not stretch the peek. */
table { max-width: 100%; border-collapse: collapse; }
img, video { max-width: 100%; height: auto; }
${o.dark && !o.paper ? `/*
 * Dark surface, mail that only set text colours. Those colours were chosen for a white page
 * (#222 on #191919 is invisible), so they give way to the app's own text colour. Only elements
 * the sanitiser tagged are touched, and mail that paints its own background never reaches this
 * branch — it goes on paper instead. The colour being overridden is an inline style, which only
 * an !important author rule outranks; the scope is one attribute the sanitiser controls.
 */
[data-mr-fg] { color: ${text} !important; }
a[data-mr-fg] { color: ${accent} !important; }
` : ''}
a { color: ${accent}; text-decoration: underline; text-underline-offset: 2px; }
a:hover { text-decoration-thickness: 2px; }
p { margin: 0 0 12px; }
h1, h2, h3, h4 { line-height: 1.3; margin: 20px 0 8px; font-weight: 600; }
h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: 16px; }
ul, ol { margin: 0 0 12px; padding-left: 24px; }
li { margin: 2px 0; }
hr { border: 0; border-top: 1px solid ${divider}; margin: 16px 0; }
code, kbd, samp { font-family: ${t['--font-mono']}; font-size: 0.9em; background: ${fill}; padding: 1px 4px; border-radius: 3px; }
pre { font-family: ${t['--font-mono']}; font-size: 13px; background: ${fill}; padding: 12px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
blockquote { margin: 10px 0; padding: 2px 0 2px 14px; border-left: 2px solid ${divider}; color: ${muted}; }
.mr-plain { white-space: normal; }
.mr-plain > div { min-height: 1.55em; }

/* Blocked remote image: keep the box so layout survives, show it is missing. */
img[data-mr-blocked], img[data-mr-cid] {
  background: ${fill}; border: 1px dashed ${divider}; border-radius: 4px;
  min-width: 32px; min-height: 32px; box-sizing: border-box; color: ${muted};
  font-size: 12px; font-family: ${t['--font-ui']};
}

/* Quoted history: hidden until the parent adds .mr-show-quote to <html>. */
[data-mr-quote] { display: none; }
.mr-show-quote [data-mr-quote] { display: revert; }

::selection { background: ${accent}33; }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: ${t['--c-border']}; border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
`.trim()
}

/**
 * The full `srcdoc`. No scripts run in here (the iframe has no `allow-scripts`), so the
 * document is inert; the parent drives height and the quote toggle from the outside.
 */
export function buildBodyDocument(o: BodyDocumentOptions): string {
  return [
    '<!doctype html>',
    `<html lang="en" data-mr-scheme="${escapeAttr(o.paper ? 'paper' : o.dark ? 'dark' : 'light')}">`,
    '<head><meta charset="utf-8">',
    // Belt and braces: even if a <base>/<meta refresh> slipped through, this CSP forbids
    // every network fetch the document could attempt on its own.
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: https: http: cid:; style-src \'unsafe-inline\'; font-src data:;">',
    `<style>${buildBodyCss(o)}</style>`,
    '</head><body>',
    o.html,
    '</body></html>'
  ].join('')
}
