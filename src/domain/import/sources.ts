import type { RawTable } from './table'

/**
 * Méthodes d'import. Toutes produisent le même RawTable, ensuite mappé puis validé par le même code :
 * ajouter une source (connecteur, photo/OCR) revient à écrire un lecteur qui renvoie un RawTable.
 */
export type ImportSourceId = 'csv' | 'xlsx' | 'paste' | 'manual' | 'api' | 'ocr'

export type ImportSource = {
  id: ImportSourceId
  label: string
  description: string
  /** false : prévue, affichée comme indisponible, aucun lecteur n'est livré. */
  available: boolean
}

export const IMPORT_SOURCES: ImportSource[] = [
  { id: 'csv', label: 'Fichier CSV', description: 'UTF-8, séparateur « ; » ou « , » détecté, virgule décimale acceptée.', available: true },
  { id: 'xlsx', label: 'Fichier Excel (.xlsx)', description: 'Première feuille du classeur. L’ancien format .xls n’est pas lu.', available: true },
  { id: 'paste', label: 'Copier-coller', description: 'Sélectionnez les cellules dans votre tableur (en-têtes compris) et collez-les.', available: true },
  { id: 'manual', label: 'Ajout rapide en série', description: 'Saisissez plusieurs produits à la suite, ligne par ligne.', available: true },
  { id: 'api', label: 'Connecteur / API', description: 'Prévu plus tard.', available: false },
  { id: 'ocr', label: 'Photo d’une liste (OCR)', description: 'Prévu plus tard.', available: false },
]

/** Contrat d'un lecteur de source : une source future n'a qu'à l'implémenter. */
export type SourceReader<Input> = (input: Input) => Promise<RawTable> | RawTable
