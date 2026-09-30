import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANGUAGES } from '@shared/languages'

const ROOT = join(__dirname, '../../src/locales')
const PLURAL = /_(zero|one|two|few|many|other)$/
type Flat = Map<string, string>

function flatten(o: unknown, prefix = '', out: Flat = new Map()): Flat {
  if (typeof o === 'string') out.set(prefix, o)
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}
const base = (k: string): string => k.replace(PLURAL, '')
const load = (lng: string, ns: string): Flat => flatten(JSON.parse(readFileSync(join(ROOT, lng, `${ns}.json`), 'utf8')))
const placeholders = (s: string): string[] => [...s.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]).sort()
const namespaces = readdirSync(join(ROOT, 'en')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))

describe.each(LANGUAGES.filter((l) => l.code !== 'en').map((l) => l.code))('locale %s', (lng) => {
  it.each(namespaces)('%s matches English keys and placeholders', (ns) => {
    const en = load('en', ns)
    const tr = load(lng, ns)
    const enBases = new Set([...en.keys()].map(base))
    const trBases = new Set([...tr.keys()].map(base))
    expect([...enBases].filter((k) => !trBases.has(k)), 'missing keys').toEqual([])
    expect([...trBases].filter((k) => !enBases.has(k)), 'extra keys').toEqual([])
    const enPh = new Map<string, string[]>()
    for (const [k, v] of en) enPh.set(base(k), [...new Set([...(enPh.get(base(k)) ?? []), ...placeholders(v)])].sort())
    for (const [k, v] of tr) {
      const want = enPh.get(base(k)) ?? []
      const got = placeholders(v)
      // A plural form may legitimately omit {{count}} (e.g. "one" -> "a message"); every other placeholder must survive.
      const allowed = new Set(want)
      expect(got.filter((p) => !allowed.has(p)), `unknown placeholder in ${k}`).toEqual([])
      if (!PLURAL.test(k)) expect([...new Set(got)], `placeholders in ${k}`).toEqual(want)
    }
  })
})
