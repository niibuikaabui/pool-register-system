import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ggedrhvdqpaorkklpdcw.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_H7MJN92bB-MSusBPrvBpMQ_hWprganl'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
