/**
 * Supabase データバックアップスクリプト
 *
 * 使い方:
 *   node scripts/backup.js                    # 日付のみ
 *   node scripts/backup.js before-pricing-fix # ラベル付き
 *
 * 出力:
 *   backups/backup_YYYY-MM-DD_HHmm[_ラベル].json
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

// .env.local から環境変数を読み込む
function loadEnv() {
  const envPath = join(projectRoot, '.env.local')
  if (existsSync(envPath)) {
    readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const [key, ...vals] = line.split('=')
      if (key && vals.length) process.env[key.trim()] = vals.join('=').trim()
    })
  }
}
loadEnv()

const SUPABASE_URL = 'https://ggedrhvdqpaorkklpdcw.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_H7MJN92bB-MSusBPrvBpMQ_hWprganl'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const TABLES = [
  'tables', 'members', 'sessions', 'menu_items',
  'order_items', 'pricing_master', 'shop_settings',
]

async function backup() {
  const label = process.argv[2] || ''
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`
  const filename = `backup_${date}_${time}${label ? '_' + label : ''}.json`

  console.log('🔄 バックアップ開始...')

  const result = {}
  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select('*')
    if (error) {
      console.error(`❌ ${table}: ${error.message}`)
    } else {
      result[table] = data
      console.log(`✅ ${table}: ${data.length}件`)
    }
  }

  const backupDir = join(projectRoot, 'backups')
  if (!existsSync(backupDir)) mkdirSync(backupDir)

  const filepath = join(backupDir, filename)
  writeFileSync(filepath, JSON.stringify({ exportedAt: now.toISOString(), label, data: result }, null, 2), 'utf8')
  console.log(`\n💾 保存完了: backups/${filename}`)
}

backup().catch(console.error)
