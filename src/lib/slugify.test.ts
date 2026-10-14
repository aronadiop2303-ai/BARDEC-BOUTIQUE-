import { describe, expect, it } from 'vitest'
import { randomSuffix, slugify, withSuffix } from './slugify'

const SLUG_RULE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

describe('slugify', () => {
  it('retire accents, majuscules et ponctuation', () => {
    expect(slugify('Quincaillerie Diop & Fils')).toBe('quincaillerie-diop-fils')
    expect(slugify('École Excellence')).toBe('ecole-excellence')
    expect(slugify('  --Mon   espace!!  ')).toBe('mon-espace')
  })

  it('renvoie une valeur de repli si rien n’est exploitable', () => {
    expect(slugify('!!!')).toBe('site')
    expect(slugify('', 'espace')).toBe('espace')
  })

  it('respecte toujours la contrainte SQL, même tronqué', () => {
    for (const input of ['a'.repeat(47) + ' b', 'Très long nom de boutique de quincaillerie générale à Dakar Plateau', 'x-']) {
      const slug = slugify(input)
      expect(SLUG_RULE.test(slug)).toBe(true)
      expect(slug.length).toBeLessThanOrEqual(48)
    }
  })

  it('produit des suffixes courts et valides', () => {
    const suffix = randomSuffix()
    expect(suffix).toMatch(/^[a-z0-9]{4}$/)
    expect(SLUG_RULE.test(withSuffix('mon-espace'))).toBe(true)
    expect(withSuffix('mon-espace', 'ab12')).toBe('mon-espace-ab12')
  })
})
