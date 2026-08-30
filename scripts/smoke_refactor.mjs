// リファクタ後のスモークテスト: 主要画面を巡回してコンソールエラー・表示崩れを検出
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173/pool-register-system'
const SS = 'C:/Users/bravy/AppData/Local/Temp/claude/c--claude-cowork-pool-register-system/91350ad4-0c5f-485b-a08a-3a667019df43/scratchpad'
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD
if (!EMAIL || !PASSWORD) {
  console.error('TEST_EMAIL と TEST_PASSWORD を環境変数にセットしてください')
  process.exit(1)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 300)))

// ログイン
await page.goto(BASE + '/#/')
await page.waitForTimeout(1500)
if (await page.locator('input[type="password"]').count()) {
  await page.fill('input[type="email"], input[placeholder*="mail"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.locator('button:has-text("ログイン")').click()
  await page.waitForTimeout(2500)
}

// 1) Dashboard（データ読み込み完了を待つ）
await page.waitForSelector('text=台の状況', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(1000)
await page.screenshot({ path: `${SS}/smoke_1_dashboard.png` })
const dashText = await page.locator('body').innerText()
console.log('DASHBOARD:', dashText.includes('台の状況') ? 'OK' : 'NG', '| 使用中表示:', /使用中/.test(dashText))

// 2) 台をクリック（既存伝票 or 新規作成はしない: 空き台クリックは伝票を作るので使用中の台のみ）
const inUse = page.locator('span.text-green-700', { hasText: '件' }).first()
let visitedTable = false
if (await inUse.count()) {
  await inUse.click()
  await page.waitForTimeout(1500)
  const t = await page.locator('body').innerText()
  console.log('TABLE SLIPS:', /伝票一覧/.test(t) ? 'OK' : 'NG', '| 合計表示:', /全員合計/.test(t))
  await page.screenshot({ path: `${SS}/smoke_2_tableslips.png` })
  visitedTable = true
  // 3) 伝票詳細（最初の伝票）
  const slip = page.locator('button:has-text("伝票 1")').first()
  if (await slip.count()) {
    await slip.click()
    await page.waitForTimeout(2000)
    const c = await page.locator('body').innerText()
    console.log('CHECKOUT:', /会員|プレー設定|合計/.test(c) ? 'OK' : 'NG', '| 料金表示:', /¥[\d,]+/.test(c))
    await page.screenshot({ path: `${SS}/smoke_3_checkout.png` })
  } else {
    console.log('CHECKOUT: SKIP (伝票なし)')
  }
} else {
  console.log('TABLE SLIPS/CHECKOUT: SKIP (使用中の台なし)')
}
if (!visitedTable) {
  // 使用中の台がなければ既存セッションに直接入らずスキップ（DBを汚さない）
}

// 4) レポート
await page.goto(BASE + '/#/reports')
await page.waitForTimeout(2500)
const r = await page.locator('body').innerText()
console.log('REPORTS:', /売上|レポート/.test(r) ? 'OK' : 'NG', '| 金額表示:', /¥[\d,]+|0円|円/.test(r))
await page.screenshot({ path: `${SS}/smoke_4_reports.png` })

console.log('\nCONSOLE ERRORS:', errors.length)
errors.slice(0, 10).forEach(e => console.log(' -', e))
await browser.close()
