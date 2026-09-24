import { describe, expect, it } from 'vitest'
import {
  CODE_TTL_MS, activeVerificationCode, detectVerificationCode as detect
} from '../../src/renderer/features/reader/codes'

describe('detectVerificationCode: positives', () => {
  const positives: [string, string][] = [
    ['Your code is 482913', '482913'],
    ['Your verification code is 482913.', '482913'],
    ['Your verification code: 482913', '482913'],
    ['Verification code:\n482913\nIt expires in 10 minutes.', '482913'],
    ['Code: 4829', '4829'],
    ['Use 482913 as your security code', '482913'],
    ['482913 is your Amazon OTP', '482913'],
    ['482913 is your verification code', '482913'],
    ['OTP: 73921845', '73921845'],
    ['Your OTP is 739218', '739218'],
    ['Your one-time password is 739218', '739218'],
    ['One-time passcode 739218', '739218'],
    ['Your PIN is 5921', '5921'],
    ['Enter the code below: 739218', '739218'],
    ['Your Apple ID Code is: 739218. Don\'t share it with anyone.', '739218'],
    ['G-123456 is your Google verification code.', '123456'],
    ['Your Google verification code is 123456', '123456'],
    ['Your code is 123 456', '123456'],
    ['Your code is 123-456', '123456'],
    ['Enter code 12345678 to sign in', '12345678'],
    ['Use code 4321 to verify your phone number', '4321'],
    ['Security code: 048213', '048213'],
    ['Your login code is 048213. Expires in 5 min', '048213'],
    // French
    ['Votre code de vérification est 482913', '482913'],
    ['Votre code de confirmation : 482913', '482913'],
    ['Votre code à usage unique est 482913', '482913'],
    ['Code de sécurité : 482913', '482913'],
    ['482913 est votre code de vérification', '482913'],
    ['Utilisez le code 482913 pour vous connecter', '482913'],
    ['Saisissez le code suivant : 482913', '482913'],
    ['Votre mot de passe à usage unique est 482913', '482913'],
    ['Code d\'accès : 4829', '4829'],
    ['Code de vérification : 482 913', '482913']
  ]
  it.each(positives)('%s', (text, code) => expect(detect(text)).toBe(code))

  it('takes the first code in reading order', () => {
    expect(detect('Your code is 111222. Or use the backup code 333444')).toBe('111222')
  })
})

describe('detectVerificationCode: look-alikes are rejected', () => {
  const negatives: string[] = [
    // prices
    'Your total is $1234.56',
    'Total: 1234 EUR',
    'Payment of 12345 € received',
    'You saved £2500 this year',
    'Price: $ 4999',
    'Only 1,234 left in stock',
    // phone numbers
    'Call us at 555-123-4567',
    'Call +33 1 23 45 67 89 for help',
    'Call 0800 123 456',
    'Phone: 5551234',
    'Tel : 0612345678',
    // dates and times
    'Your appointment is on 12/05/2026',
    'Delivered 2026-05-12',
    'Meeting at 10:30 in room 2048',
    'Copyright 2026 Acme Inc.',
    // order / reference numbers (no code keyword)
    'Your order #123456 has shipped',
    'Order number: 4829134',
    'Commande n° 482913 expédiée',
    'Invoice 20260512 is attached',
    'Tracking number 12345678',
    'Ticket 48291 was updated',
    'Confirmation number 482913',
    // promo codes: the digits are not the code
    'Use code SAVE20 for 2025 savings',
    'Use code SPRING2025 at checkout',
    'Enter promo code 25OFF today',
    // keyword too far away, or none at all
    'Hello, we received 482913 requests to reset your password',
    'Newsletter #4829',
    'Your code was reviewed and the ticket 482913 is closed',
    'Number 482913',
    'Reset your password: https://example.com/reset?token=482913',
    // wrong length
    'Your code is 123',
    'Your code is 123456789',
    'Your code is 1234567890123',
    // alphanumerics glued to digits
    'Your code is A482913',
    'Your code is 482913abc',
    '',
    '   '
  ]
  it.each(negatives)('%j', (text) => expect(detect(text)).toBeNull())

  it('handles null / undefined', () => {
    expect(detect(null)).toBeNull()
    expect(detect(undefined)).toBeNull()
  })
})

describe('activeVerificationCode', () => {
  const now = 1_700_000_000_000
  const text = 'Your code is 482913'
  it('is offered while fresh', () => {
    const r = activeVerificationCode(text, now - 60_000, now)
    expect(r?.code).toBe('482913')
    expect(r?.expiresAt).toBe(now - 60_000 + CODE_TTL_MS)
  })
  it('is offered at 9m59s and gone at 10m', () => {
    expect(activeVerificationCode(text, now - (CODE_TTL_MS - 1000), now)).not.toBeNull()
    expect(activeVerificationCode(text, now - CODE_TTL_MS, now)).toBeNull()
  })
  it('tolerates a sender clock slightly in the future', () => {
    expect(activeVerificationCode(text, now + 30_000, now)?.code).toBe('482913')
  })
  it('never offers when nothing was detected', () => {
    expect(activeVerificationCode('Lunch at noon?', now, now)).toBeNull()
  })
  it('rejects a non-finite timestamp', () => {
    expect(activeVerificationCode(text, NaN, now)).toBeNull()
  })
})
