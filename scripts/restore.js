/**
 * Supabase データ復元スクリプト
 *
 * 使い方:
 *   node scripts/restore.js                                      # 最新バックアップを復元
 *   node scripts/restore.js backups/backup_2026-06-07_1200.json  # 指定ファイルを復元
 *   node scripts/restore.js list                                  # バックアップ一覧を表示
 *
 * 前提:
 *   .env.local に SUPABASE_SERVICE_KEY=... を記載
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'

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
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

const RESTORE_ORDER = [
  'tables', 'members', 'menu_items', 'pricing_master',
  'shop_settings', 'sessions', 'order_items',
]
const DELETE_ORDER = [
  'order_items', 'sessions', 'members', 'menu_items',
  'pricing_master', 'shop_settings', 'tables',
]

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer) }))
}

function listBackups() {
  const backupDir = join(projectRoot, 'backups')
  if (!existsSync(backupDir)) { console.log('バックアップが1件もありません。'); return [] }
  const files = readdirSync(backupDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
  if (files.length === 0) { console.log('バックアップが1件もありません。'); return [] }
  console.log('\n📂 バックアップ一覧（新しい順）:')
  files.forEach((f, i) => {
    const marker = i === 0 ? ' ← 最新' : ''
    console.log(`  ${String(i+1).padStart(2)}. ${f}${marker}`)
  })
  return files
}

function getLatestBackup() {
  const backupDir = join(projectRoot, 'backups')
  if (!existsSync(backupDir)) return null
  const files = readdirSync(backupDir).filter(f => f.endsWith('.json')).sort()
  return files.length ? join(backupDir, files[files.length - 1]) : null
}

async function restore() {
  const arg = process.argv[2]

  // 一覧表示
  if (arg === 'list') { listBackups(); return }

  if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY が設定されていません')
    console.error('   .env.local に以下を追記してください:')
    console.error('   SUPABASE_SERVICE_KEY=your_service_role_key')
    process.exit(1)
  }

  // ファイル特定
  let backupFile = arg
  if (!backupFile) {
    backupFile = getLatestBackup()
    if (!backupFile) { console.error('❌ バックアップが見つかりません'); process.exit(1) }
    console.log(`📂 最新バックアップを使用: ${backupFile}`)
  }
  if (!existsSync(backupFile)) {
    console.error(`❌ ファイルが見つかりません: ${backupFile}`); process.exit(1)
  }

  const backup = JSON.parse(readFileSync(backupFile, 'utf8'))
  console.log(`\n📅 エクスポート日時: ${backup.exportedAt}`)
  if (backup.label) console.log(`🏷  ラベル: ${backup.label}`)
  console.log('')
  for (const table of RESTORE_ORDER) {
    console.log(`   ${table}: ${backup.data[table]?.length ?? 0}件`)
  }

  console.log('\n⚠️  警告: 既存のデータはすべて削除されます。')
  const answer = await prompt('本当に復元しますか？ (yes と入力で実行): ')
  if (answer.trim() !== 'yes') { console.log('キャンセルしました。'); process.exit(0) }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  console.log('\n🗑️  既存データを削除中...')
  for (const table of DELETE_ORDER) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) { console.error(`❌ ${table} の削除に失敗: ${error.message}`); process.exit(1) }
    console.log(`   ✅ ${table} 削除完了`)
  }

  console.log('\n📥 データを復元中...')
  for (const table of RESTORE_ORDER) {
    const rows = backup.data[table]
    if (!rows || rows.length === 0) { console.log(`   ⏭️  ${table}: データなし（スキップ）`); continue }
    const { error } = await supabase.from(table).insert(rows)
    if (error) { console.error(`❌ ${table} の復元に失敗: ${error.message}`); process.exit(1) }
    console.log(`   ✅ ${table}: ${rows.length}件 復元完了`)
  }

  console.log('\n🎉 復元完了しました。')
}

restore().catch(console.error)
