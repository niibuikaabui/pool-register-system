// リファクタ後のE2E確認: 伝票作成→プレー開始→種別切り替え→終了(locked_fee確定)→会計→後片付け
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const BASE = 'http://localhost:5173/pool-register-system'
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD
if (!EMAIL || !PASSWORD) {
  console.error('TEST_EMAIL と TEST_PASSWORD を環境変数にセットしてください')
  process.exit(1)
}
const sb = createClient(
  'https://ggedrhvdqpaorkklpdcw.supabase.co',
  'sb_publishable_H7MJN92bB-MSusBPrvBpMQ_hWprganl'
)
const { error: le } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
if (le) { console.error('DBログインエラー:', le.message); process.exit(1) }

// 空き台を1つ選ぶ
const { data: tables } = await sb.from('tables').select('*').order('table_number')
const { data: unpaid } = await sb.from('sessions').select('table_id').eq('is_paid', false)
const usedIds = new Set((unpaid || []).map(s => s.table_id))
const target = (tables || []).find(t => t.table_number < 6 && !usedIds.has(t.id))
if (!target) { console.error('空き台がありません'); process.exit(1) }
console.log(`対象: #${target.table_number}台`)

const { data: pricing } = await sb.from('pricing_master').select('*')
const rateH = pricing.find(p => p.customer_type === 'general' && p.pricing_type === 'hourly_multi')
const rateF = pricing.find(p => p.customer_type === 'general' && p.pricing_type === 'freetime_no_beer')
console.log(`時間制レート: ${rateH?.price_per_minute}/分, フリータイム: ${rateF?.freetime_price}円`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 200)))

let sessionId = null
let ok = true
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'OK' : 'NG'} ${label}${detail ? ' | ' + detail : ''}`)
  if (!cond) ok = false
}

try {
  // ログイン
  await page.goto(BASE + '/#/')
  await page.waitForTimeout(1500)
  if (await page.locator('input[type="password"]').count()) {
    await page.fill('input[type="email"], input[placeholder*="mail"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)
    await page.locator('button:has-text("ログイン")').click()
  }
  await page.waitForSelector('text=台の状況', { timeout: 20000 })
  await page.waitForTimeout(1000)

  // 1) 空き台クリック → 伝票作成 → 会計画面へ
  await page.locator(`button:has-text("#${target.table_number}")`).first().click()
  await page.waitForSelector('text=ビリヤード開始', { timeout: 15000 })
  sessionId = (page.url().match(/checkout\/([0-9a-f-]+)/) || [])[1]
  check('伝票作成→会計画面遷移', !!sessionId, `session=${sessionId}`)

  // 2) プレー開始
  await page.locator('button:has-text("ビリヤード開始")').click()
  await page.waitForSelector('text=プレー中', { timeout: 10000 })
  check('プレー開始（time_block作成）', true)

  // 3) 1分経過待ち（時間制料金が発生する状態にする）
  console.log('   … 65秒待機（1分ぶんの料金発生）')
  await page.waitForTimeout(65000)

  // 4) プレー終了 → locked_fee確定・total_play_fee保存
  await page.locator('button:has-text("終了")').first().click()
  await page.waitForTimeout(2500)
  const { data: blocks } = await sb.from('time_blocks').select('*').eq('session_id', sessionId)
  const expectedFee = Math.ceil(((rateH?.price_per_minute || 0) * 1) / 50) * 50
  check('locked_fee が確定', blocks?.[0]?.locked_fee != null, `locked_fee=${blocks?.[0]?.locked_fee}（期待 ${expectedFee}）`)
  check('locked_fee の金額', blocks?.[0]?.locked_fee === expectedFee)
  const { data: s2 } = await sb.from('sessions').select('total_play_fee').eq('id', sessionId).single()
  check('sessions.total_play_fee 保存', s2?.total_play_fee === expectedFee, `total_play_fee=${s2?.total_play_fee}`)

  // 5) 種別切り替え（終了後のみ可能）: フリータイム→合計がfreetime_price、時間制に戻すとlocked_fee由来の金額に復元
  if (rateF?.freetime_price) {
    await page.locator('button:has-text("フリータイム（ビール無）")').click()
    await page.waitForTimeout(1500)
    const body1 = await page.locator('body').innerText()
    const expectF = `¥${rateF.freetime_price.toLocaleString()}`
    check('種別切替→フリータイム料金表示', body1.includes(expectF), `期待 ${expectF}`)
    const { data: s1 } = await sb.from('sessions').select('pricing_type').eq('id', sessionId).single()
    check('種別切替がDBに反映', s1?.pricing_type === 'freetime_no_beer', `pricing_type=${s1?.pricing_type}`)
    // 時間制に戻す → locked_fee の金額が復元される（再計算バグの検証）
    await page.locator('button:has-text("時間制（複数）")').click()
    await page.waitForTimeout(1500)
    const body2 = await page.locator('body').innerText()
    check('時間制に戻すとlocked_fee金額を復元', body2.includes(`¥${expectedFee.toLocaleString()}`), `期待 ¥${expectedFee}`)
  }

  // 6) 会計
  await page.locator('button:has-text("会計へ進む")').click()
  await page.waitForTimeout(800)
  await page.locator('button:has-text("会計完了")').click()
  await page.waitForSelector('text=台の状況', { timeout: 15000 })
  const { data: s3 } = await sb.from('sessions').select('is_paid, grand_total').eq('id', sessionId).single()
  const { data: t3 } = await sb.from('tables').select('status').eq('id', target.id).single()
  check('会計完了（is_paid）', s3?.is_paid === true, `grand_total=${s3?.grand_total}（期待 ${expectedFee}）`)
  check('会計金額', s3?.grand_total === expectedFee)
  check('台が空きに戻る', t3?.status === 'empty', `status=${t3?.status}`)

  console.log('\nCONSOLE ERRORS:', errors.length)
  errors.slice(0, 8).forEach(e => console.log(' -', e))
} finally {
  // 後片付け: テストで作ったセッションと時間ブロックを削除（売上レポートを汚さない）
  if (sessionId) {
    await sb.from('time_blocks').delete().eq('session_id', sessionId)
    await sb.from('sessions').delete().eq('id', sessionId)
    console.log('テストデータ削除済み:', sessionId)
  }
  await browser.close()
}
console.log(ok ? '\nE2E ALL PASS' : '\nE2E FAILED')
process.exit(ok ? 0 : 1)
