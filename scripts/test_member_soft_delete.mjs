// 会員論理削除機能のE2Eテスト: 新規作成→削除→削除済み一覧確認→復活→後片付け(物理削除)
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const BASE = 'http://localhost:5173/pool-register-system'
const SS = 'C:/Users/bravy/AppData/Local/Temp/claude/c--claude-cowork-pool-register-system/b48c8450-65da-4f77-a359-ad5def40f0d6/scratchpad'
const TEST_NAME = 'テスト削除会員_' + Date.now()

const sb = createClient(
  'https://ggedrhvdqpaorkklpdcw.supabase.co',
  'sb_publishable_H7MJN92bB-MSusBPrvBpMQ_hWprganl'
)
const { error: le } = await sb.auth.signInWithPassword({ email: 'bravy123@hotmail.com', password: 'bravy123@hotmail.com' })
if (le) { console.error('DBログインエラー:', le.message); process.exit(1) }

let ok = true
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'OK' : 'NG'} ${label}${detail ? ' | ' + detail : ''}`)
  if (!cond) ok = false
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 300)))
page.on('dialog', async d => { console.log('DIALOG:', d.message()); await d.accept() })

try {
  // ログイン
  await page.goto(BASE + '/#/')
  await page.waitForTimeout(1500)
  if (await page.locator('input[type="password"]').count()) {
    await page.fill('input[type="email"], input[placeholder*="mail"]', 'bravy123@hotmail.com')
    await page.fill('input[type="password"]', 'bravy123@hotmail.com')
    await page.locator('button:has-text("ログイン")').click()
    await page.waitForTimeout(2000)
  }

  // 会員管理ページへ
  await page.goto(BASE + '/#/members')
  await page.waitForSelector('text=会員管理', { timeout: 15000 })
  await page.waitForTimeout(800)

  // isAdmin向けボタンが出ているか(削除済みを表示/表示中トグルボタン、状態でテキストが変わる)
  const toggleBtn = page.locator('button', { hasText: /削除済み/ })
  check('管理者用「削除済みを表示」ボタンが表示される', await toggleBtn.count() > 0)

  // 新規登録
  await page.locator('button:has-text("+ 新規登録")').click()
  await page.waitForSelector('text=新規会員登録')
  await page.fill('input[placeholder="山田 太郎"]', TEST_NAME)
  await page.locator('button:has-text("保存")').click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${SS}/mdel_1_created.png` })

  // 検索して対象を絞り込み
  await page.fill('input[placeholder*="バーコードリーダー対応"]', TEST_NAME)
  await page.waitForTimeout(600)
  const row = page.locator('div.divide-y > div', { hasText: TEST_NAME })
  check('作成した会員が通常一覧に表示される', await row.count() === 1)

  // 削除ボタンをクリック
  await row.locator('button:has-text("削除")').click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${SS}/mdel_2_after_delete.png` })
  const rowAfterDelete = page.locator('div.divide-y > div', { hasText: TEST_NAME })
  check('削除後、通常一覧から消える', await rowAfterDelete.count() === 0)

  // 削除済みを表示に切替
  await toggleBtn.click()
  await page.waitForTimeout(800)
  const rowInDeleted = page.locator('div.divide-y > div', { hasText: TEST_NAME })
  check('削除済み一覧に表示される', await rowInDeleted.count() === 1)
  check('削除済み行に「復活」ボタンがある', await rowInDeleted.locator('button:has-text("復活")').count() === 1)
  check('削除済み行に「削除」「編集」ボタンが無い', await rowInDeleted.locator('button:has-text("編集")').count() === 0)
  await page.screenshot({ path: `${SS}/mdel_3_deleted_list.png` })

  // 復活
  await rowInDeleted.locator('button:has-text("復活")').click()
  await page.waitForTimeout(1000)
  const rowInDeletedAfterRestore = page.locator('div.divide-y > div', { hasText: TEST_NAME })
  check('復活後、削除済み一覧から消える', await rowInDeletedAfterRestore.count() === 0)

  // 通常一覧に戻して確認
  await toggleBtn.click()
  await page.waitForTimeout(800)
  const rowBackToNormal = page.locator('div.divide-y > div', { hasText: TEST_NAME })
  check('復活後、通常一覧に戻る', await rowBackToNormal.count() === 1)
  check('復活後、編集・削除ボタンが両方ある', await rowBackToNormal.locator('button:has-text("編集")').count() === 1 && await rowBackToNormal.locator('button:has-text("削除")').count() === 1)
  await page.screenshot({ path: `${SS}/mdel_4_restored.png` })

  check('コンソール/ページエラー無し', errors.length === 0, errors.join(' / '))
} catch (e) {
  console.error('例外:', e)
  ok = false
} finally {
  await browser.close()
}

// 後片付け: テストデータを完全に物理削除
const { data: testRows } = await sb.from('members').select('id,name').ilike('name', 'テスト削除会員_%')
if (testRows && testRows.length) {
  const ids = testRows.map(r => r.id)
  const { error: delErr } = await sb.from('members').delete().in('id', ids)
  console.log(delErr ? `後片付けエラー: ${delErr.message}` : `後片付けOK: ${ids.length}件削除 (${testRows.map(r => r.name).join(', ')})`)
} else {
  console.log('後片付け: 対象データなし')
}

console.log(ok ? '\n=== 総合結果: OK ===' : '\n=== 総合結果: NG ===')
process.exit(ok ? 0 : 1)
