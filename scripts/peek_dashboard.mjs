import { chromium } from 'playwright';
const BASE = 'http://localhost:5173/pool-register-system';
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('TEST_EMAIL と TEST_PASSWORD を環境変数にセットしてください');
  process.exit(1);
}
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// ログイン
await page.goto(BASE + '/#/');
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(1000);
await page.fill('input[type="email"], input[placeholder*="mail"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.locator('button:has-text("ログイン")').click();
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2000);

await page.screenshot({ path: 'scripts/ss_after_login.png' });

// テキスト一覧
const all = await page.locator('button, a, [role="button"]').allTextContents();
console.log('Clickable texts:', all.map(t => t.trim()).filter(Boolean).slice(0, 30));

const cards = await page.locator('.rounded-xl, .rounded-lg').allTextContents();
console.log('\nCards:', cards.map(t => t.trim().substring(0, 50)).filter(Boolean).slice(0, 20));

await browser.close();
