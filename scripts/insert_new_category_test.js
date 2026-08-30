// 新区分（大学生・高校生）テストデータ挿入スクリプト
// 実行: $env:TEST_EMAIL="staff@example.com"; $env:TEST_PASSWORD="your_password"; node scripts/insert_new_category_test.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ggedrhvdqpaorkklpdcw.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_H7MJN92bB-MSusBPrvBpMQ_hWprganl'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD

// JST日時 → ISO
function jst(date, time) {
  return new Date(`${date}T${time}:00+09:00`).toISOString()
}
// N分前
function minsAgo(mins) {
  return new Date(Date.now() - mins * 60 * 1000).toISOString()
}
// 50円単位切り上げ
function roundUp50(n) {
  return Math.ceil(n / 50) * 50
}

const TODAY = '2026-06-06'

// 料金（pricing_masterの値）
const PRICE = {
  general:     { single: 10,        multi: 6.666667,  freetime: 2000 },
  female:      { single: 8.333333,  multi: 5,         freetime: 1500 },
  university:  { single: 8.333333,  multi: 5.833333,  freetime: 2000 },
  high_school: { single: 8.333333,  multi: 4.166667,  freetime: null },
}

async function run() {
  if (!EMAIL || !PASSWORD) { console.error('TEST_EMAIL/TEST_PASSWORD をセット'); process.exit(1) }
  const { error: authError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (authError) { console.error('ログイン失敗:', authError.message); process.exit(1) }
  console.log('✅ ログイン成功\n')

  // マスタ取得
  const { data: tables } = await supabase.from('tables').select('*').order('table_number')
  const { data: members } = await supabase.from('members').select('*')
  const { data: menus }   = await supabase.from('menu_items').select('*').eq('is_available', true)

  const tbl  = (n) => tables.find(t => t.table_number === n)
  const menu = (name) => menus.find(m => m.name === name)
  const memberId = members[0]?.id  // 新本博文 (general)

  const cola   = menu('コーラ')    // ¥200
  const oolong = menu('ウーロン茶') // ¥200

  // ───────────────────────────────────────────────
  // ■ PAID SESSIONS（DBに直接会計済みとして挿入）
  // ───────────────────────────────────────────────

  // T01: 大学生 時間制一人 60分 + コーラ×1
  // play = roundUp50(60 × 8.333) = 500
  {
    const play = roundUp50(60 * PRICE.university.single) // 500
    const food = cola.price                               // 200
    const { data: sess } = await supabase.from('sessions').insert({
      table_id: tbl(1).id, customer_type: 'university', pricing_type: 'hourly_single',
      started_at: jst(TODAY,'10:00'), ended_at: jst(TODAY,'11:00'),
      is_paid: true, total_play_fee: play, total_food_fee: food, grand_total: play + food,
    }).select().single()
    await supabase.from('order_items').insert({ session_id: sess.id, menu_item_id: cola.id, quantity: 1, unit_price: cola.price })
    console.log(`[T01] 大学生 時間制一人 60分+コーラ  play=${play} food=${food} total=${play+food}  ✅`)
  }

  // T02: 高校生 時間制一人 45分 ドリンクなし
  // play = roundUp50(45 × 8.333) = roundUp50(375) = 400
  {
    const play = roundUp50(45 * PRICE.high_school.single) // 400
    const { data: sess } = await supabase.from('sessions').insert({
      table_id: tbl(2).id, customer_type: 'high_school', pricing_type: 'hourly_single',
      started_at: jst(TODAY,'10:00'), ended_at: jst(TODAY,'10:45'),
      is_paid: true, total_play_fee: play, total_food_fee: 0, grand_total: play,
    }).select().single()
    console.log(`[T02] 高校生 時間制一人 45分         play=${play} food=0 total=${play}  ✅`)
  }

  // T03: 大学生 時間制複数 90分
  // play = roundUp50(90 × 5.833) = roundUp50(525) = 550
  {
    const play = roundUp50(90 * PRICE.university.multi) // 550
    const { data: sess } = await supabase.from('sessions').insert({
      table_id: tbl(3).id, customer_type: 'university', pricing_type: 'hourly_multi',
      started_at: jst(TODAY,'11:00'), ended_at: jst(TODAY,'12:30'),
      is_paid: true, total_play_fee: play, total_food_fee: 0, grand_total: play,
    }).select().single()
    console.log(`[T03] 大学生 時間制複数 90分         play=${play} food=0 total=${play}  ✅`)
  }

  // T04: 高校生 時間制複数 60分 + コーラ(キャンセル) → food=0
  // play = roundUp50(60 × 4.167) = roundUp50(250) = 250
  {
    const play = roundUp50(60 * PRICE.high_school.multi) // 250
    const { data: sess } = await supabase.from('sessions').insert({
      table_id: tbl(4).id, customer_type: 'high_school', pricing_type: 'hourly_multi',
      started_at: jst(TODAY,'11:00'), ended_at: jst(TODAY,'12:00'),
      is_paid: true, total_play_fee: play, total_food_fee: 0, grand_total: play,
    }).select().single()
    await supabase.from('order_items').insert({
      session_id: sess.id, menu_item_id: cola.id, quantity: 1, unit_price: cola.price,
      cancelled_at: jst(TODAY,'11:30'), // コーラはキャンセル済み
    })
    console.log(`[T04] 高校生 時間制複数 60分+コーラ取消  play=${play} food=0 total=${play}  ✅`)
  }

  // T05: 台5に一般+大学生+女性+高校生 4伝票同台 同時会計
  // 全員 hourly_multi 60分
  {
    const cases = [
      { ct: 'general',     play: roundUp50(60 * PRICE.general.multi),     food: 0,          note: 'ドリンクなし' },
      { ct: 'university',  play: roundUp50(60 * PRICE.university.multi),  food: cola.price, note: 'コーラ×1' },
      { ct: 'female',      play: roundUp50(60 * PRICE.female.multi),      food: 0,          note: 'ドリンクなし' },
      { ct: 'high_school', play: roundUp50(60 * PRICE.high_school.multi), food: 0,          note: 'ドリンクなし' },
    ]
    for (const c of cases) {
      const { data: sess } = await supabase.from('sessions').insert({
        table_id: tbl(5).id, customer_type: c.ct, pricing_type: 'hourly_multi',
        started_at: jst(TODAY,'13:00'), ended_at: jst(TODAY,'14:00'),
        is_paid: true, total_play_fee: c.play, total_food_fee: c.food, grand_total: c.play + c.food,
      }).select().single()
      if (c.food > 0) await supabase.from('order_items').insert({ session_id: sess.id, menu_item_id: cola.id, quantity: 1, unit_price: cola.price })
      console.log(`[T05] ${c.ct.padEnd(11)} 台5同時会計  play=${c.play} food=${c.food}  ✅`)
    }
  }

  // T17: 深夜またぎ 大学生 hourly_multi  ended=06/07 02:00 JST → 営業日=06/06
  {
    const play = roundUp50(60 * PRICE.university.multi) // 350
    const { data: sess } = await supabase.from('sessions').insert({
      table_id: tbl(8).id, customer_type: 'university', pricing_type: 'hourly_multi',
      started_at: jst('2026-06-07','01:00'), ended_at: jst('2026-06-07','02:00'),
      is_paid: true, total_play_fee: play, total_food_fee: 0, grand_total: play,
    }).select().single()
    console.log(`[T17] 大学生 深夜またぎ 06/07 01-02時  play=${play}  営業日=06/06  ✅`)
  }

  console.log('\n────────────────────────────────')
  console.log('■ アクティブセッション（UI操作テスト用）')
  console.log('────────────────────────────────')

  // ───────────────────────────────────────────────
  // ■ ACTIVE SESSIONS（UI操作が必要なもの）
  // ───────────────────────────────────────────────

  // T06: 台2 大学生1人(hourly_single)スタート → UI操作:途中で高校生が来て複数料金(hourly_multi)に切替
  {
    const { data: s } = await supabase.from('sessions').insert({
      table_id: tbl(2).id, customer_type: 'university', pricing_type: 'hourly_single',
      started_at: minsAgo(45), is_paid: false,
    }).select().single()
    await supabase.from('time_blocks').insert({ session_id: s.id, started_at: minsAgo(45) })
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(2).id)
    console.log(`[T06] 台2 大学生hourly_single(45分経過) → 【UI】hourly_multi切替+高校生伝票追加+同時会計`)
  }

  // T07: 台3 一般+大学生 hourly_multi → UI操作:一般が先行会計 → 大学生をhourly_singleに切替 → 会計
  {
    for (const ct of ['general', 'university']) {
      const { data: s } = await supabase.from('sessions').insert({
        table_id: tbl(3).id, customer_type: ct, pricing_type: 'hourly_multi',
        started_at: minsAgo(60), is_paid: false,
      }).select().single()
      await supabase.from('time_blocks').insert({ session_id: s.id, started_at: minsAgo(60) })
    }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(3).id)
    console.log(`[T07] 台3 一般+大学生 hourly_multi(60分) → 【UI】一般先行会計 → 大学生hourly_single切替 → 会計`)
  }

  // T08: 台4 一般+大学生+高校生 → UI操作:大学生と高校生が先に会計 → 一般は残る → 一般会計
  {
    for (const ct of ['general', 'university', 'high_school']) {
      const { data: s } = await supabase.from('sessions').insert({
        table_id: tbl(4).id, customer_type: ct, pricing_type: 'hourly_multi',
        started_at: minsAgo(50), is_paid: false,
      }).select().single()
      await supabase.from('time_blocks').insert({ session_id: s.id, started_at: minsAgo(50) })
    }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(4).id)
    console.log(`[T08] 台4 一般+大学生+高校生(50分) → 【UI】大学生・高校生先行会計 → 一般残り → 一般会計`)
  }

  // T09: 台5（アクティブ） 大学生+女性 → UI操作:プレー停止 → その他台に移動してドリンク追加 → 会計
  // T05のpaid sessionsと同台だが、is_paid=falseで追加
  {
    for (const [ct, pt] of [['university','hourly_single'],['female','hourly_single']]) {
      const { data: s } = await supabase.from('sessions').insert({
        table_id: tbl(5).id, customer_type: ct, pricing_type: pt,
        started_at: minsAgo(30), is_paid: false,
      }).select().single()
      await supabase.from('time_blocks').insert({ session_id: s.id, started_at: minsAgo(30) })
    }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(5).id)
    console.log(`[T09] 台5 大学生+女性(30分) → 【UI】プレー停止 → その他台移動 → ドリンク追加 → 会計`)
  }

  // T10: 台6 一般+大学生 → UI操作:全員で台7に移動（台6終了・台7で新伝票） → 台7で継続 → 会計
  {
    for (const ct of ['general','university']) {
      const { data: s } = await supabase.from('sessions').insert({
        table_id: tbl(6).id, customer_type: ct, pricing_type: 'hourly_multi',
        started_at: minsAgo(40), is_paid: false,
      }).select().single()
      await supabase.from('time_blocks').insert({ session_id: s.id, started_at: minsAgo(40) })
    }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(6).id)
    console.log(`[T10] 台6 一般+大学生(40分) → 【UI】全員台7へ移動 → 台7で継続 → 各自会計`)
  }

  // T11: 台7 高校生2伝票（ゲスト名あり） → UI操作:1伝票先行会計 → もう1伝票続行 → 会計
  {
    for (const [i, name] of [[0,'高校生A'],[1,'高校生B']]) {
      const { data: s } = await supabase.from('sessions').insert({
        table_id: tbl(7).id, customer_type: 'high_school', pricing_type: 'hourly_single',
        started_at: minsAgo(40 - i*5), guest_name: name, is_paid: false,
      }).select().single()
      await supabase.from('time_blocks').insert({ session_id: s.id, started_at: minsAgo(40 - i*5) })
    }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(7).id)
    console.log(`[T11] 台7 高校生A・高校生B 2伝票 → 【UI】高校生A先行会計 → 高校生B残り → 会計`)
  }

  // T12: 台8 大学生フリータイム + 高校生時間制一人 → コーラをUI操作でキャンセル → 各自会計
  {
    const { data: s_uni } = await supabase.from('sessions').insert({
      table_id: tbl(8).id, customer_type: 'university', pricing_type: 'freetime',
      started_at: minsAgo(80), is_paid: false,
    }).select().single()
    // フリータイムはtime_block不要
    await supabase.from('order_items').insert({ session_id: s_uni.id, menu_item_id: cola.id, quantity: 1, unit_price: cola.price })

    const { data: s_hs } = await supabase.from('sessions').insert({
      table_id: tbl(8).id, customer_type: 'high_school', pricing_type: 'hourly_single',
      started_at: minsAgo(80), is_paid: false,
    }).select().single()
    await supabase.from('time_blocks').insert({ session_id: s_hs.id, started_at: minsAgo(80) })
    await supabase.from('order_items').insert({ session_id: s_hs.id, menu_item_id: oolong.id, quantity: 1, unit_price: oolong.price })

    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(8).id)
    console.log(`[T12] 台8 大学生FT+高校生時間制(80分) → 【UI】大学生側コーラをキャンセル → 各自会計`)
  }

  // T13: 台9 大学生(会員:新本博文)+一般(ゲスト名:山田様) → 大学生先行会計 → 一般後で会計
  {
    const { data: s_uni } = await supabase.from('sessions').insert({
      table_id: tbl(9).id, customer_type: 'university', pricing_type: 'hourly_multi',
      started_at: minsAgo(55), member_id: memberId, is_paid: false,
    }).select().single()
    await supabase.from('time_blocks').insert({ session_id: s_uni.id, started_at: minsAgo(55) })

    const { data: s_gen } = await supabase.from('sessions').insert({
      table_id: tbl(9).id, customer_type: 'general', pricing_type: 'hourly_multi',
      started_at: minsAgo(55), guest_name: '山田様', is_paid: false,
    }).select().single()
    await supabase.from('time_blocks').insert({ session_id: s_gen.id, started_at: minsAgo(55) })

    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(9).id)
    console.log(`[T13] 台9 大学生(会員)+一般(山田様)(55分) → 【UI】大学生先行会計 → レポートに会員名・ゲスト名`)
  }

  // T14: 台10 一般+女性+大学生+高校生 → UI操作:女性と高校生がその他台に移動 → 全員バラバラ会計
  {
    for (const ct of ['general','female','university','high_school']) {
      const { data: s } = await supabase.from('sessions').insert({
        table_id: tbl(10).id, customer_type: ct, pricing_type: 'hourly_multi',
        started_at: minsAgo(45), is_paid: false,
      }).select().single()
      await supabase.from('time_blocks').insert({ session_id: s.id, started_at: minsAgo(45) })
    }
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(10).id)
    console.log(`[T14] 台10 一般+女性+大学生+高校生(45分) → 【UI】女性+高校生その他台移動 → 全員各自会計`)
  }

  // T15: 台1 大学生+高校生 → 大学生のみプレー一時停止(time_block終了済み) → 高校生は継続 → 大学生再開後 → 各自会計
  {
    const { data: s_uni } = await supabase.from('sessions').insert({
      table_id: tbl(1).id, customer_type: 'university', pricing_type: 'hourly_multi',
      started_at: minsAgo(70), is_paid: false,
    }).select().single()
    // ブロック1: 70分前〜40分前（終了済み）
    await supabase.from('time_blocks').insert({ session_id: s_uni.id, started_at: minsAgo(70), ended_at: minsAgo(40) })
    // ブロック2: 20分前〜（現在進行中）
    await supabase.from('time_blocks').insert({ session_id: s_uni.id, started_at: minsAgo(20) })

    const { data: s_hs } = await supabase.from('sessions').insert({
      table_id: tbl(1).id, customer_type: 'high_school', pricing_type: 'hourly_multi',
      started_at: minsAgo(70), is_paid: false,
    }).select().single()
    // 高校生は連続プレー
    await supabase.from('time_blocks').insert({ session_id: s_hs.id, started_at: minsAgo(70) })

    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(1).id)
    console.log(`[T15] 台1 大学生(停止→再開・2block)+高校生(連続70分) → 【UI】プレー確認・各自会計`)
  }

  // T16: 台2（T06と同台） 大学生(ゲスト名)+一般(ゲスト名) → 各自会計 → レポートでゲスト名確認
  {
    const { data: s_uni } = await supabase.from('sessions').insert({
      table_id: tbl(2).id, customer_type: 'university', pricing_type: 'hourly_single',
      started_at: minsAgo(30), guest_name: '鈴木大学生', is_paid: false,
    }).select().single()
    await supabase.from('time_blocks').insert({ session_id: s_uni.id, started_at: minsAgo(30) })

    const { data: s_gen } = await supabase.from('sessions').insert({
      table_id: tbl(2).id, customer_type: 'general', pricing_type: 'hourly_single',
      started_at: minsAgo(30), guest_name: '鈴木一般', is_paid: false,
    }).select().single()
    await supabase.from('time_blocks').insert({ session_id: s_gen.id, started_at: minsAgo(30) })

    await supabase.from('tables').update({ status: 'in_use' }).eq('id', tbl(2).id)
    console.log(`[T16] 台2 大学生(鈴木大学生)+一般(鈴木一般)(30分) → 【UI】各自会計 → レポートでゲスト名確認`)
  }

  // ───────────────────────────────────────────────
  // ■ サマリー
  // ───────────────────────────────────────────────
  console.log('\n════════════════════════════════')
  console.log('全テストデータ挿入完了')
  console.log('════════════════════════════════')
  console.log('')
  console.log('【DBに挿入済み（会計済み）】')
  console.log('  T01 大学生 時間制一人 60分+コーラ         → 台1')
  console.log('  T02 高校生 時間制一人 45分                → 台2')
  console.log('  T03 大学生 時間制複数 90分                → 台3')
  console.log('  T04 高校生 時間制複数 60分+コーラ取消     → 台4')
  console.log('  T05 一般+大学生+女性+高校生 4伝票同台同時会計 → 台5')
  console.log('  T17 大学生 深夜またぎ 06/07 02:00終了    → 台8')
  console.log('')
  console.log('【アクティブセッション（UI操作が必要）】')
  console.log('  T06 台2  大学生hourly_single → 途中でhourly_multi切替+高校生追加')
  console.log('  T07 台3  一般+大学生 → 一般先行会計 → 大学生1人料金切替')
  console.log('  T08 台4  一般+大学生+高校生 → 大学生・高校生先行会計 → 一般残り')
  console.log('  T09 台5  大学生+女性 → プレー停止 → その他台移動')
  console.log('  T10 台6  一般+大学生 → 全員台7に移動')
  console.log('  T11 台7  高校生A・B 2伝票 → 高校生A先行会計')
  console.log('  T12 台8  大学生FT+高校生時間制 → コーラキャンセル → 各自会計')
  console.log('  T13 台9  大学生(会員)+一般(山田様) → 大学生先行会計')
  console.log('  T14 台10 一般+女性+大学生+高校生 → 女性+高校生その他台移動')
  console.log('  T15 台1  大学生(停止→再開)+高校生(連続) → 各自会計')
  console.log('  T16 台2  大学生(鈴木)+一般(鈴木) → 各自会計')
  console.log('')
  console.log('【レポート確認（全会計後）】')
  console.log('  T18 日別レポート 6/6 → 大学生・高校生の区分別集計')
  console.log('  T19 月別レポート 2026-06 → 全区分の件数・金額')
  console.log('  T20 CSVダウンロード → 大学生・高校生の列確認')
}

run().catch(console.error)
