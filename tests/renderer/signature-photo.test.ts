// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readSignaturePhoto, writeSignaturePhoto } from '@/features/settings/lib/signaturePhoto'
import { sanitizeSignature } from '@/features/settings/lib/signatureSanitize'
import { renderSignatureTemplate, SIGNATURE_TEMPLATES } from '@/features/settings/sections/signatureTemplates'

const tpl = SIGNATURE_TEMPLATES.find((t) => t.id === 'photo-left')!
const acct = { name: 'Ada Lovelace', email: 'ada@example.com', color: '#2383e2' }
const withAvatar = { ...acct, avatarUrl: 'data:image/jpeg;base64,QUJD' }
const DATA = 'data:image/jpeg;base64,AQID'

describe('signature photo editing', () => {
  it('reads initials / image / none', () => {
    expect(readSignaturePhoto(renderSignatureTemplate(tpl, acct)).kind).toBe('initials')
    expect(readSignaturePhoto(renderSignatureTemplate(tpl, withAvatar))).toEqual({ kind: 'image', src: withAvatar.avatarUrl })
    expect(readSignaturePhoto('<p>Ada</p>').kind).toBe('none')
  })
  it('replaces, removes and resets to the account picture, surviving sanitisation', () => {
    const base = sanitizeSignature(renderSignatureTemplate(tpl, acct))
    const replaced = sanitizeSignature(writeSignaturePhoto(base, DATA, acct)!)
    expect(readSignaturePhoto(replaced)).toEqual({ kind: 'image', src: DATA })
    expect(replaced).toContain('Ada Lovelace')
    const removed = sanitizeSignature(writeSignaturePhoto(replaced, null, acct)!)
    expect(readSignaturePhoto(removed).kind).toBe('initials')
    const back = sanitizeSignature(writeSignaturePhoto(removed, 'account', withAvatar)!)
    expect(readSignaturePhoto(back)).toEqual({ kind: 'image', src: withAvatar.avatarUrl })
  })
  it('returns null when the signature has no photo cell', () => {
    expect(writeSignaturePhoto('<p>Ada</p>', DATA, acct)).toBeNull()
  })
})
