import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://ggedrhvdqpaorkklpdcw.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_H7MJN92bB-MSusBPrvBpMQ_hWprganl'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
