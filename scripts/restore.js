/**
 * Supabase データ復元スクリプト
 *
 * 使い方:
 *   node scripts/restore.js backups/backup_2026-06-06.json
 *
 * 注意:
 *   - 既存データは削除されてからバックアップデータで上書きされます
 *   - service_role キーが必要です（RLSをバイパスするため）
 *   - 実行前に必ず対象ファイルを確認してください
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { createInterface } from 'readline'

const SUPABASE_URL = 'https://ggedrhvdqpaorkklpdcw.supabase.co'

// service_role キーが必要（Supabase Dashboard > Settings > API > service_role key）
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

// 復元順序（外部キー制約のため依存元から先に復元）
const RESTORE_ORDER = [
  'tables',
  'members',
  'menu_items',
  'pricing_master',
  'shop_settings',
  'sessions',
  'order_items',
]

// 削除順序（外部キー制約のため依存先から先に削除）
const DELETE_ORDER = [
  'order_items',
  'sessions',
  'members',
  'menu_items',
  'pricing_master',
  'shop_settings',
  'tables',
]

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer) }))
}

async function restore() {
  // 引数チェック
  const backupFile = process.argv[2]
  if (!backupFile) {
    console.error('❌ バックアップファイルを指定してください')
    console.error('   使い方: node scripts/restore.js backups/backup_2026-06-06.json')
    process.exit(1)
  }

  if (!existsSync(backupFile)) {
    console.error(`❌ ファイルが見つかりません: ${backupFile}`)
    process.exit(1)
  }

  if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY が設定されていません')
    console.error('   実行方法: SUPABASE_SERVICE_KEY=your_key node scripts/restore.js <file>')
    process.exit(1)
  }

  // バックアップ内容を読み込み
  const backup = JSON.parse(readFileSync(backupFile, 'utf8'))
  console.log(`📂 バックアップファイル: ${backupFile}`)
  console.log(`📅 エクスポート日時: ${backup.exportedAt}`)
  console.log('')

  // 件数確認
  for (const table of RESTORE_ORDER) {
    const count = backup.data[table]?.length ?? 0
    console.log(`   ${table}: ${count}件`)
  }

  // 確認プロンプト
  console.log('')
  console.log('⚠️  警告: 既存のデータはすべて削除されます。')
  const answer = await prompt('本当に復元しますか？ (yes と入力で実行): ')
  if (answer.trim() !== 'yes') {
    console.log('キャンセルしました。')
    process.exit(0)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // 既存データを削除
  console.log('\n🗑️  既存データを削除中...')
  for (const table of DELETE_ORDER) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) {
      console.error(`❌ ${table} の削除に失敗: ${error.message}`)
      process.exit(1)
    }
    console.log(`   ✅ ${table} 削除完了`)
  }

  // データを復元
  console.log('\n📥 データを復元中...')
  for (const table of RESTORE_ORDER) {
    const rows = backup.data[table]
    if (!rows || rows.length === 0) {
      console.log(`   ⏭️  ${table}: データなし（スキップ）`)
      continue
    }
    const { error } = await supabase.from(table).insert(rows)
    if (error) {
      console.error(`❌ ${table} の復元に失敗: ${error.message}`)
      process.exit(1)
    }
    console.log(`   ✅ ${table}: ${rows.length}件 復元完了`)
  }

  console.log('\n🎉 復元完了しました。')
}

restore().catch(console.error)
