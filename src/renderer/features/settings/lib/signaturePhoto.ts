import i18n from 'i18next'
import type { Account } from '@shared/types'
import { initialsCell, photoCell } from '../sections/signatureTemplates'

type PhotoAccount = Pick<Account, 'name' | 'email' | 'avatarUrl' | 'color'>

/** Output size of the cropped signature photo (px, square). Shown at 56px, so ~2x for retina. */
export const PHOTO_PX = 128

/**
 * The signature's photo is the first cell of a table layout ("Photo left"): an `<img>`, or the
 * initials `<span>` placeholder. Anything else (no table) has no editable photo.
 */
function photoNode(root: HTMLElement): HTMLElement | null {
  const cell = root.querySelector('table td')
  if (!cell) return null
  const first = cell.firstElementChild as HTMLElement | null
  if (!first) return null
  if (first.tagName === 'IMG') return first
  if (first.tagName === 'SPAN' && /border-radius:\s*50%/i.test(first.getAttribute('style') ?? '')) return first
  return null
}

export type SignaturePhotoState = { kind: 'none' } | { kind: 'initials' } | { kind: 'image'; src: string }

export function readSignaturePhoto(html: string): SignaturePhotoState {
  const root = document.createElement('div')
  root.innerHTML = html
  const n = photoNode(root)
  if (!n) return { kind: 'none' }
  return n.tagName === 'IMG' ? { kind: 'image', src: n.getAttribute('src') ?? '' } : { kind: 'initials' }
}

/**
 * Replace the signature photo: a `data:`/https source, `null` for the initials placeholder, or
 * `'account'` for the account's own profile picture. Returns `null` if the HTML has no photo cell.
 */
export function writeSignaturePhoto(html: string, photo: string | null | 'account', account: PhotoAccount): string | null {
  const root = document.createElement('div')
  root.innerHTML = html
  const n = photoNode(root)
  if (!n) return null
  const cell = photo === 'account' ? photoCell(account) : photo ? photoCell(account, photo) : initialsCell(account)
  const holder = document.createElement('div')
  holder.innerHTML = cell
  n.replaceWith(holder.firstElementChild!)
  return root.innerHTML
}

/** Centre-crop `file` to a square and downscale to PHOTO_PX, returned as a JPEG data URI. */
export async function cropToSquareDataUri(file: Blob, px = PHOTO_PX): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error(i18n.t('settings:signature.photo.unreadable')))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    if (!side) throw new Error(i18n.t('settings:signature.photo.empty'))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = px
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(i18n.t('settings:signature.photo.unavailable'))
    ctx.fillStyle = '#ffffff' // JPEG has no alpha; transparent PNGs land on white like the email body
    ctx.fillRect(0, 0, px, px)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, px, px)
    return canvas.toDataURL('image/jpeg', 0.88)
  } finally {
    URL.revokeObjectURL(url)
  }
}
