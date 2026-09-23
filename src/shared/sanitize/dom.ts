/**
 * Minimal structural DOM surface.
 *
 * `src/shared/**` is compiled by `tsconfig.node.json`, whose `lib` is ES2023 only (no DOM) so
 * that main-process code cannot reach for browser globals by accident. The sanitiser genuinely
 * needs to walk a DOM, so it describes just the members it touches instead of naming lib.dom
 * types. At runtime these are ordinary `Element`s (browser or jsdom).
 */
export interface El {
  /** Upper-case for HTML elements. */
  tagName: string
  id: string
  className: string
  innerHTML: string
  outerHTML: string
  textContent: string | null
  parentElement: El | null
  previousElementSibling: El | null
  nextElementSibling: El | null
  firstElementChild: El | null
  children: ArrayLike<El>
  attributes: ArrayLike<{ name: string; value: string }>
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  hasAttribute(name: string): boolean
  querySelectorAll(selector: string): ArrayLike<El>
  matches(selector: string): boolean
  remove(): void
}

/** `Array.from` on a NodeList needs lib.dom to type; this does not. */
export function toArray<T>(list: ArrayLike<T>): T[] {
  const out: T[] = []
  for (let i = 0; i < list.length; i++) out.push(list[i])
  return out
}

/** Element children as a plain array. */
export const childElements = (el: El): El[] => toArray(el.children)

/** Attribute names as a plain array (safe to mutate the element while iterating it). */
export const attributeNames = (el: El): string[] => toArray(el.attributes).map((a) => a.name)
