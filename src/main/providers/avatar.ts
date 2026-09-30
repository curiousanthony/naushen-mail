/**
 * Profile-picture helpers shared by the provider connectors.
 *
 * Google's `picture` URL (lh3.googleusercontent.com) is hotlink-sensitive and can rot, so it is
 * fetched once in the main process and stored as a small `data:` URI in `accounts.avatar_url`;
 * the renderer never has to reach the network for it.
 */

const MAX_BYTES = 512 * 1024

/** Google serves `...=s96-c`; ask for a crisper 256px crop. Leaves URLs without a size suffix alone. */
export function googlePictureUrl(url: string, size = 256): string {
  return url.replace(/=s\d+(-c)?$/i, `=s${size}-c`).replace(/([?&])sz=\d+/i, `$1sz=${size}`)
}

export async function fetchImageDataUri(url: string, doFetch: typeof fetch = fetch, headers?: Record<string, string>): Promise<string | undefined> {
  try {
    if (!/^https:\/\//i.test(url)) return undefined
    const r = await doFetch(url, { headers })
    if (!r.ok) return undefined
    const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return undefined
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_BYTES) return undefined
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return undefined // a missing photo must never break sign-in or launch
  }
}
