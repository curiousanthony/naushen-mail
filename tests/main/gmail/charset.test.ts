import { describe, expect, it } from 'vitest'
import { decodeBytes } from '../../../src/main/providers/gmail/text'

describe('decodeBytes', () => {
  const utf8 = Buffer.from('Suite à mon rendez-vous, réfléchir ensemble à un projet', 'utf8')

  it('trusts UTF-8 bytes over a mislabelled single-byte charset', () => {
    for (const label of ['us-ascii', 'iso-8859-1', 'windows-1252']) {
      expect(decodeBytes(utf8, label)).toBe('Suite à mon rendez-vous, réfléchir ensemble à un projet')
    }
  })

  it('still decodes genuine latin-1 bytes', () => {
    expect(decodeBytes(Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'iso-8859-1')).toBe('café')
  })
})
