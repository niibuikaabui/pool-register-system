/**
 * Supabase データバックアップスクリプト
 *
 * 使い方:
 *   node scripts/backup.js
 *
 * 出力:
 *   backups/backup_YYYY-MM-DD.json
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const SUPABASE_URL = 'https://ggedrhvdqpaorkklpdcw.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_H7MJN92bB-MSusBPrvBpMQ_hWprganl'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const TABLES = [
  'tables',
  'members',
  'sessions',
  'menu_items',
  'order_items',
  'pricing_master',
  'shop_settings',
]

async function backup() {
  console.log('🔄 バックアップ開始...')

  const result = {}
  let hasError = false

  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select('*')
    if (error) {
      console.error(`❌ ${table}: ${error.message}`)
      hasError = true
    } else {
      result[table] = data
      console.log(`✅ ${table}: ${data.length}件`)
    }
  }

  if (hasError) {
    console.error('\n⚠️  一部テーブルの取得に失敗しました。ログインが必要なテーブルはサービスキーが必要です。')
    console.error('   Supabase Dashboard > Settings > API > service_role key を SUPABASE_SERVICE_KEY に設定してください。')
  }

  // バックアップファイルを保存
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const backupDir = join(__dirname, '..', 'backups')
  if (!existsSync(backupDir)) mkdirSync(backupDir)

  const date = new Date().toISOString().slice(0, 10)
  const filename = join(backupDir, `backup_${date}.json`)

  writeFileSync(filename, JSON.stringify({ exportedAt: new Date().toISOString(), data: result }, null, 2), 'utf8')
  console.log(`\n💾 保存完了: ${filename}`)
}

backup().catch(console.error)
