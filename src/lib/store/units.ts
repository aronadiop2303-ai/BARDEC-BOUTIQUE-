import type { SupabaseClient } from '@supabase/supabase-js'
import type { Unit } from '../../domain/hardware/units'
import { toError } from '../errors'

export async function listUnits(client: SupabaseClient, siteId: string): Promise<Unit[]> {
  const { data, error } = await client.from('product_units').select('id,code,label,dimension,decimal_places')
    .eq('site_id', siteId).order('label')
  if (error) throw toError(error)
  return (data ?? []) as Unit[]
}
