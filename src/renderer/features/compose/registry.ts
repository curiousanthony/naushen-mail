/**
 * Live editor instances, keyed by composer id.
 *
 * Populated by `Composer` and read by the headless-screenshot hook in `index.tsx`, which
 * needs a way to drive the editor while the sidebar and reader that normally open a
 * composer still live on other branches. Its own module so `index` and `Composer` do not
 * import each other.
 */
export const editorRegistry = new Map<string, unknown>()
