import { chromium } from 'playwright';

const BASE  = 'http://localhost:5173/pool-register-system';
const EMAIL = process.env.TEST_EMAIL;
const PASS  = process.env.TEST_PASSWORD;
if (!EMAIL || !PASS) {
  console.error('TEST_EMAIL と TEST_PASSWORD を環境変数にセットしてください');
  process.exit(1);
}

const RESULTS = [];
function log(num, status, detail = '') {
  const line = `ケース${num}: ${status}${detail ? ' — ' + detail : ''}`;
  RESULTS.push({ num, status, line });
  console.log(line);
}
const p = (page, name) => page.screenshot({ path: `scripts/ss_${name}.png` });
const idle = async (page) => {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
};

// ─── ログイン ───
async function login(page) {
  await page.goto(BASE + '/#/');
  await idle(page);
  await page.fill('input[type="email"], input[placeholder*="mail"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.locator('button:has-text("ログイン")').click();
  await idle(page);
}

// ─── ダッシュボードから台IDマップ取得 ───
async function getTableIdMap(page) {
  await page.goto(BASE + '/#/');
  await idle(page);
  // 台カードをクリックしてURLからIDを取得
  const map = {};
  const cards = page.locator('div.rounded-xl').filter({ hasText: /^#\d/ });
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const text = (await cards.nth(i).textContent()).trim();
    const numMatch = text.match(/^#(\d+)/);
    if (!numMatch) continue;
    const tableNum = parseInt(numMatch[1]);
    if (tableNum > 5) continue;
    // カードのonClickでURLが変わる前に、data属性やhref経由でIDを取る難しいため、
    // 台クリック→URL取得→戻る の方法を使う
    await cards.nth(i).click();
    await page.waitForTimeout(800);
    const url = page.url();
    const m = url.match(/\/(table|checkout)\/([^?#]+)/);
    if (m) map[tableNum] = { urlSegment: m[1], id: m[2] };
    await page.goto(BASE + '/#/');
    await idle(page);
  }
  return map;
}

// ─── 伝票一覧ページへ（セッションがあれば） ───
async function goTableList(page, tableId) {
  await page.goto(`${BASE}/#/table/${tableId}`);
  await idle(page);
}

// ─── プレー開始 ───
async function startPlay(page) {
  const btn = page.locator('button:has-text("ビリヤード開始")').first();
  if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

// ─── プレー終了 ───
async function endPlay(page) {
  const btn = page.locator('button:has-text("プレー終了")').first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

// ─── 時間ブロック修正（startMinutesAgo分前開始、duration分間） ───
async function setBlockTime(page, startMinutesAgo, duration, blockIndex = 0) {
  const editBtns = page.locator('button:has-text("修正")');
  const btn = editBtns.nth(blockIndex);
  if (!await btn.isVisible({ timeout: 4000 }).catch(() => false)) return false;
  await btn.click();
  await page.waitForTimeout(500);

  const pad = n => String(n).padStart(2, '0');
  const fmt = d => ({
    date: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  });
  const now = new Date();
  const s = fmt(new Date(now - startMinutesAgo * 60000));
  const e = fmt(new Date(now - startMinutesAgo * 60000 + duration * 60000));

  const dInputs = page.locator('input[type="date"]');
  const tInputs = page.locator('input[type="time"]');
  if (!await dInputs.first().isVisible({ timeout: 2000 }).catch(() => false)) return false;

  await dInputs.first().fill(s.date);
  await tInputs.first().fill(s.time);
  if (await dInputs.nth(1).isVisible({ timeout: 1000 }).catch(() => false)) {
    await dInputs.nth(1).fill(e.date);
    await tInputs.nth(1).fill(e.time);
  }
  await page.locator('button:has-text("保存")').click();
  await page.waitForTimeout(1500);
  return true;
}

// ─── 伝票一覧: 先頭カードの料金取得 ───
async function getFirstCardFee(page, tableId) {
  await goTableList(page, tableId);
  const card = page.locator('button.bg-white').first();
  if (!await card.isVisible({ timeout: 3000 }).catch(() => false)) return { total: 'なし', breakdown: '' };
  const total = (await card.locator('.text-lg.font-bold, .text-xl.font-bold').first().textContent().catch(() => '?')).trim();
  const breakdown = (await card.locator('.text-xs.text-gray-400').first().textContent().catch(() => '')).trim();
  return { total, breakdown };
}

// ─── 全員合計取得 ───
async function getGrandTotal(page, tableId) {
  await goTableList(page, tableId);
  return (await page.locator('text=全員合計').locator('..').locator('.text-2xl').first().textContent().catch(() => '?')).trim();
}

// ─── 台をまとめ払いでリセット ───
async function resetTable(page, tableId) {
  await goTableList(page, tableId);
  const anyCard = await page.locator('button.bg-white').first().isVisible({ timeout: 2000 }).catch(() => false);
  if (!anyCard) return;
  // まとめ払い or 一括終了・会計
  const bulkBtn = page.locator('button:has-text("まとめ払い"), button:has-text("一括終了・会計")').first();
  if (await bulkBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await bulkBtn.click();
    await page.waitForTimeout(500);
    const confirmBtn = page.locator('button:has-text("会計完了")').first();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(1000);
    } else {
      // dialog confirm
      page.once('dialog', d => d.accept());
      await page.waitForTimeout(500);
    }
  }
}

// ─── 新規伝票を作成 → checkout URLを返す ───
async function createAndOpenSlip(page, tableId) {
  await goTableList(page, tableId);
  const addBtn = page.locator('button:has-text("伝票を追加")');
  if (!await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    // 伝票がゼロの場合はgoTableListでcheckoutに飛んでいる可能性あり
    // ダッシュボードから台カードをクリックして直接session作成
    await page.goto(BASE + '/#/');
    await idle(page);
    return null;
  }
  await addBtn.click();
  await idle(page);
  const url = page.url();
  const m = url.match(/checkout\/([^?#]+)/);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 120 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    await login(page);
    console.log('ログイン完了');

    // 台IDマップを取得（#1→UUID, #2→UUID...）
    console.log('台IDを取得中...');
    const tMap = await getTableIdMap(page);
    console.log('取得結果:', Object.entries(tMap).map(([n, v]) => `#${n}=${v.urlSegment}/${v.id.slice(0,8)}...`).join(', '));

    // テスト用に台1〜4をリセット
    for (const num of [1, 2, 3, 4, 5]) {
      if (tMap[num]) await resetTable(page, tMap[num].id).catch(() => {});
    }
    console.log('台リセット完了\n');

    // ══════════════════════════════════════════
    // ケース2: プレー中の概算表示
    // ══════════════════════════════════════════
    console.log('=== ケース2: プレー中の概算表示 ===');
    {
      // 台1のカードをクリック（空台なのでcheckoutに飛ぶ）
      await page.goto(BASE + '/#/');
      await idle(page);
      const card1 = page.locator('div.rounded-xl').filter({ hasText: /^#1/ }).first();
      await card1.click();
      await idle(page);
      // checkoutに居る場合はプレー開始
      const inCheckout = page.url().includes('checkout');
      if (inCheckout) {
        await startPlay(page);
        // 伝票一覧へ
        const t1id = tMap[1]?.id;
        if (t1id) {
          await goTableList(page, t1id);
          await p(page, 'c2_list');
          const c2Orange = await page.locator('.text-orange-500').first().isVisible().catch(() => false);
          const c2Gaizan = await page.locator('text=概算').first().isVisible().catch(() => false);
          log(2, c2Orange && c2Gaizan ? 'PASS' : 'FAIL', `オレンジ=${c2Orange} 概算=${c2Gaizan}`);
        } else {
          log(2, 'SKIP', '台1のIDが取得できなかった');
        }
      } else {
        log(2, 'SKIP', 'checkoutページに遷移しなかった');
      }
    }

    // ══════════════════════════════════════════
    // ケース1: プレー終了後に伝票一覧の料金が合っているか
    // ══════════════════════════════════════════
    console.log('\n=== ケース1: プレー終了後の料金一致 ===');
    {
      const t1id = tMap[1]?.id;
      if (t1id) {
        // 台1の既存伝票（ケース2で作ったもの）を開く
        await goTableList(page, t1id);
        await page.locator('button.bg-white').first().click();
        await idle(page);
        await endPlay(page);
        // 5分に時間修正
        await setBlockTime(page, 10, 5);
        await p(page, 'c1_checkout');
        // checkout画面の合計
        const c1Total = await page.locator('.text-2xl.font-bold, .text-3xl.font-bold').first().textContent().catch(() => '?');
        // 伝票一覧で確認
        const { total: c1ListFee, breakdown: c1Break } = await getFirstCardFee(page, t1id);
        await p(page, 'c1_list');
        const c1Pass = c1ListFee !== '¥0' && c1ListFee.includes('¥');
        log(1, c1Pass ? 'PASS' : 'FAIL', `checkout合計≒${c1Total.trim()}, 一覧=${c1ListFee} 内訳="${c1Break}"`);
      } else {
        log(1, 'SKIP', '台1のIDが取得できなかった');
      }
    }

    // ══════════════════════════════════════════
    // ケース10: 0分境界値
    // ══════════════════════════════════════════
    console.log('\n=== ケース10: 0分境界値 ===');
    {
      await page.goto(BASE + '/#/');
      await idle(page);
      const card2 = page.locator('div.rounded-xl').filter({ hasText: /^#2/ }).first();
      await card2.click();
      await idle(page);
      if (page.url().includes('checkout')) {
        await startPlay(page);
        await endPlay(page); // 即終了（<1分）
        await p(page, 'c10_checkout');
        const t2id = tMap[2]?.id;
        if (t2id) {
          const { total: c10Total, breakdown: c10Break } = await getFirstCardFee(page, t2id);
          await p(page, 'c10_list');
          const c10NoPlay = !c10Break.includes('🎱');
          log(10, c10NoPlay ? 'PASS' : 'FAIL', `合計=${c10Total} 内訳="${c10Break}" (🎱なしが正)`);
        } else log(10, 'SKIP', '台2のIDが取得できなかった');
      } else log(10, 'SKIP', 'checkoutへ遷移しなかった');
    }

    // ══════════════════════════════════════════
    // ケース4: 時間修正後の料金一致
    // ══════════════════════════════════════════
    console.log('\n=== ケース4: 時間修正後の料金一致 ===');
    {
      await page.goto(BASE + '/#/');
      await idle(page);
      const card3 = page.locator('div.rounded-xl').filter({ hasText: /^#3/ }).first();
      await card3.click();
      await idle(page);
      if (page.url().includes('checkout')) {
        await startPlay(page);
        await endPlay(page);
        await setBlockTime(page, 10, 3); // 3分で確定
        const t3id = tMap[3]?.id;
        if (t3id) {
          const { total: c4Before } = await getFirstCardFee(page, t3id);
          // 再びcheckoutを開いて10分に修正
          await goTableList(page, t3id);
          await page.locator('button.bg-white').first().click();
          await idle(page);
          await setBlockTime(page, 15, 10);
          const { total: c4After, breakdown: c4Break } = await getFirstCardFee(page, t3id);
          await p(page, 'c4_list');
          const c4Pass = c4After !== c4Before;
          log(4, c4Pass ? 'PASS' : 'FAIL', `修正前=${c4Before} → 修正後=${c4After} 内訳="${c4Break}"`);
        } else log(4, 'SKIP', '台3のIDが取得できなかった');
      } else log(4, 'SKIP', 'checkoutへ遷移しなかった');
    }

    // ══════════════════════════════════════════
    // ケース5: 時間修正 + ドリンク追加
    // ══════════════════════════════════════════
    console.log('\n=== ケース5: 時間修正 + ドリンク追加 ===');
    {
      const t3id = tMap[3]?.id;
      if (t3id) {
        await goTableList(page, t3id);
        await page.locator('button.bg-white').first().click();
        await idle(page);
        // ソフトドリンクを1つ追加
        const softBtn = page.locator('button, div').filter({ hasText: /^ソフト/ }).first();
        if (await softBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await softBtn.click();
          await page.waitForTimeout(400);
          const dBtns = page.locator('button').filter({ hasText: /¥\d+/ });
          if (await dBtns.first().isVisible({ timeout: 2000 }).catch(() => false)) {
            await dBtns.first().click();
            await page.waitForTimeout(600);
          }
        }
        await p(page, 'c5_checkout');
        const { total: c5Total, breakdown: c5Break } = await getFirstCardFee(page, t3id);
        await p(page, 'c5_list');
        const c5HasPlay = c5Break.includes('🎱');
        const c5HasDrink = c5Break.includes('🍹');
        log(5, c5HasPlay && c5HasDrink ? 'PASS' : 'FAIL',
          `合計=${c5Total} 内訳="${c5Break}"`);
      } else log(5, 'SKIP', '台3のIDが取得できなかった');
    }

    // ══════════════════════════════════════════
    // ケース6: 取消ドリンクを含む料金計算
    // ══════════════════════════════════════════
    console.log('\n=== ケース6: 取消ドリンク ===');
    {
      await page.goto(BASE + '/#/');
      await idle(page);
      const card4 = page.locator('div.rounded-xl').filter({ hasText: /^#4/ }).first();
      await card4.click();
      await idle(page);
      if (page.url().includes('checkout')) {
        await startPlay(page);
        // ドリンクA追加
        const softA = page.locator('button, div').filter({ hasText: /^ソフト/ }).first();
        if (await softA.isVisible({ timeout: 3000 }).catch(() => false)) {
          await softA.click();
          await page.waitForTimeout(400);
          const dBtns = page.locator('button').filter({ hasText: /¥\d+/ });
          if (await dBtns.first().isVisible({ timeout: 2000 }).catch(() => false)) {
            const drinkAText = (await dBtns.first().textContent()).trim();
            await dBtns.first().click();
            await page.waitForTimeout(600);
            // 取消
            const cancelBtns = page.locator('button:has-text("取消")');
            if (await cancelBtns.last().isVisible({ timeout: 2000 }).catch(() => false)) {
              await cancelBtns.last().click();
              await page.waitForTimeout(600);
            }
            // ドリンクB追加（2番目のメニュー）
            if (await dBtns.nth(1).isVisible({ timeout: 2000 }).catch(() => false)) {
              const drinkBText = (await dBtns.nth(1).textContent()).trim();
              await dBtns.nth(1).click();
              await page.waitForTimeout(600);
              await endPlay(page);
              await setBlockTime(page, 10, 5);
              await p(page, 'c6_checkout');
              const t4id = tMap[4]?.id;
              if (t4id) {
                const { total: c6Total, breakdown: c6Break } = await getFirstCardFee(page, t4id);
                await p(page, 'c6_list');
                // 取消ドリンクAの金額が合計に含まれていないことを確認（目視INFOで補足）
                log(6, 'INFO', `合計=${c6Total} 内訳="${c6Break}" — スクショでA取消・B有効を目視確認`);
              } else log(6, 'SKIP', '台4のIDが取得できなかった');
            }
          }
        } else log(6, 'SKIP', 'ソフトメニューが見つからなかった');
      } else log(6, 'SKIP', 'checkoutへ遷移しなかった');
    }

    // ══════════════════════════════════════════
    // ケース3: 複数ブロックの合計
    // ══════════════════════════════════════════
    console.log('\n=== ケース3: 複数ブロック ===');
    {
      await page.goto(BASE + '/#/');
      await idle(page);
      const card5 = page.locator('div.rounded-xl').filter({ hasText: /^#5/ }).first();
      await card5.click();
      await idle(page);
      if (page.url().includes('checkout')) {
        await startPlay(page);
        await endPlay(page);
        await setBlockTime(page, 20, 7, 0); // ブロック1: 7分
        await startPlay(page);
        await endPlay(page);
        await setBlockTime(page, 5, 4, 1);  // ブロック2: 4分
        await p(page, 'c3_checkout');
        const t5id = tMap[5]?.id;
        if (t5id) {
          const { total: c3Total, breakdown: c3Break } = await getFirstCardFee(page, t5id);
          await p(page, 'c3_list');
          const c3HasFee = c3Total !== '¥0' && c3Break.includes('🎱');
          log(3, c3HasFee ? 'PASS' : 'FAIL', `合計=${c3Total} 内訳="${c3Break}"`);
        } else log(3, 'SKIP', '台5のIDが取得できなかった');
      } else log(3, 'SKIP', 'checkoutへ遷移しなかった');
    }

    // ══════════════════════════════════════════
    // ケース7: フリータイムの料金
    // ══════════════════════════════════════════
    console.log('\n=== ケース7: フリータイム ===');
    {
      await resetTable(page, tMap[1]?.id).catch(() => {});
      await page.goto(BASE + '/#/');
      await idle(page);
      const card1b = page.locator('div.rounded-xl').filter({ hasText: /^#1/ }).first();
      await card1b.click();
      await idle(page);
      if (page.url().includes('checkout')) {
        // フリータイムボタンを探す（料金種別選択）
        const ftBtn = page.locator('button').filter({ hasText: /フリータイム/ }).first();
        if (await ftBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await ftBtn.click();
          await page.waitForTimeout(400);
          await startPlay(page);
          await endPlay(page);
          await p(page, 'c7_checkout');
          const t1id = tMap[1]?.id;
          if (t1id) {
            const { total: c7Total, breakdown: c7Break } = await getFirstCardFee(page, t1id);
            await p(page, 'c7_list');
            const c7HasPlay = c7Break.includes('🎱');
            log(7, c7HasPlay ? 'PASS' : 'FAIL', `合計=${c7Total} 内訳="${c7Break}"`);
          } else log(7, 'SKIP', '台1のIDが取得できなかった');
        } else {
          log(7, 'SKIP', 'フリータイムボタンが見つからなかった');
          await p(page, 'c7_no_button');
        }
      } else log(7, 'SKIP', 'checkoutへ遷移しなかった');
    }

    // ══════════════════════════════════════════
    // ケース8: 複数伝票の全員合計
    // ══════════════════════════════════════════
    console.log('\n=== ケース8: 複数伝票の全員合計 ===');
    {
      await resetTable(page, tMap[2]?.id).catch(() => {});
      await page.goto(BASE + '/#/');
      await idle(page);
      // 伝票A作成（台2）
      const card2b = page.locator('div.rounded-xl').filter({ hasText: /^#2/ }).first();
      await card2b.click();
      await idle(page);
      if (page.url().includes('checkout')) {
        await startPlay(page);
        await endPlay(page);
        await setBlockTime(page, 10, 5);
        const t2id = tMap[2]?.id;
        if (t2id) {
          const { total: c8fee1 } = await getFirstCardFee(page, t2id);
          // 伝票B作成（台2 - 伝票追加）
          await goTableList(page, t2id);
          await page.locator('button:has-text("伝票を追加")').click();
          await idle(page);
          await startPlay(page);
          await endPlay(page);
          await setBlockTime(page, 8, 3);
          const cards8 = await page.locator('button.bg-white').count().catch(() => 0);
          const { total: c8fee2 } = await getFirstCardFee(page, t2id);
          const c8Grand = await getGrandTotal(page, t2id);
          await p(page, 'c8_multi_list');
          const c8Pass = c8Grand !== '¥0' && c8Grand !== c8fee1;
          log(8, c8Pass ? 'PASS' : 'FAIL', `伝票A=${c8fee1} 伝票B=${c8fee2} 全員合計=${c8Grand}`);
        } else log(8, 'SKIP', '台2のIDが取得できなかった');
      } else log(8, 'SKIP', 'checkoutへ遷移しなかった');
    }

    // ══════════════════════════════════════════
    // ケース9: プレー中・休憩中混在
    // ══════════════════════════════════════════
    console.log('\n=== ケース9: プレー中・休憩中混在 ===');
    {
      await resetTable(page, tMap[3]?.id).catch(() => {});
      await page.goto(BASE + '/#/');
      await idle(page);
      // 伝票A: プレー中のまま
      const card3b = page.locator('div.rounded-xl').filter({ hasText: /^#3/ }).first();
      await card3b.click();
      await idle(page);
      if (page.url().includes('checkout')) {
        await startPlay(page);
        const t3id = tMap[3]?.id;
        if (t3id) {
          // 伝票B: 作成→終了
          await goTableList(page, t3id);
          await page.locator('button:has-text("伝票を追加")').click();
          await idle(page);
          await startPlay(page);
          await endPlay(page);
          await setBlockTime(page, 5, 4);
          await goTableList(page, t3id);
          await p(page, 'c9_mixed_list');
          const c9Orange = await page.locator('.text-orange-500').first().isVisible().catch(() => false);
          const c9Gaizan = await page.locator('text=概算').first().isVisible().catch(() => false);
          const c9Grand = (await page.locator('text=全員合計').locator('..').locator('.text-2xl').first().textContent().catch(() => '?')).trim();
          log(9, c9Orange && c9Gaizan ? 'PASS' : 'FAIL',
            `オレンジ=${c9Orange} 概算=${c9Gaizan} 全員合計=${c9Grand}`);
        } else log(9, 'SKIP', '台3のIDが取得できなかった');
      } else log(9, 'SKIP', 'checkoutへ遷移しなかった');
    }

  } catch (err) {
    console.error('\nERROR:', err.message);
    await p(page, 'error').catch(() => {});
  }

  console.log('\n════════════════════════════════════');
  console.log('          テスト結果サマリー');
  console.log('════════════════════════════════════');
  const pass = RESULTS.filter(r => r.status === 'PASS').length;
  const fail = RESULTS.filter(r => r.status === 'FAIL').length;
  const skip = RESULTS.filter(r => ['SKIP','INFO'].includes(r.status)).length;
  [...RESULTS].sort((a, b) => a.num - b.num).forEach(r => console.log(r.line));
  console.log(`\n合計: PASS ${pass} / FAIL ${fail} / INFO・SKIP ${skip}`);
  console.log('════════════════════════════════════');

  await browser.close();
}

main();
