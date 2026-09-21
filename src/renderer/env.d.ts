import type { JSX as ReactJSX } from 'react'

// React 19 types no longer expose a global JSX namespace; re-export it so `JSX.Element` works everywhere.
declare global {
  namespace JSX {
    type Element = ReactJSX.Element
    type ElementType = ReactJSX.ElementType
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}
