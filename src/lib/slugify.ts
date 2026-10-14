/** Longueur maximale de la partie lisible d'un slug (le suffixe éventuel s'ajoute après). */
const MAX_BASE_LENGTH = 48

/**
 * « Quincaillerie Diop & Fils » → « quincaillerie-diop-fils ».
 * Respecte la contrainte SQL des slugs : ^[a-z0-9]+(?:-[a-z0-9]+)*$
 */
export function slugify(text: string, fallback = 'site'): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '')
  return slug || fallback
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Suffixe court et aléatoire (ex. « k3f9 ») pour départager deux slugs identiques. */
export function randomSuffix(length = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

export function withSuffix(base: string, suffix: string = randomSuffix()): string {
  return `${base}-${suffix}`
}
