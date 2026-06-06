// テストデータ挿入スクリプト
// 実行: node scripts/insert_test_data.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ggedrhvdqpaorkklpdcw.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_H7MJN92bB-MSusBPrvBpMQ_hWprganl'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// 認証（管理者でログイン）
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD

function minsAgo(mins) {
  return new Date(Date.now() - mins * 60 * 1000).toISOString()
}

async function run() {
  if (!EMAIL || !PASSWORD) {
    console.error('TEST_EMAIL と TEST_PASSWORD を環境変数にセットしてください')
    process.exit(1)
  }

  const { error: authError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (authError) { console.error('ログイン失敗:', authError.message); process.exit(1) }
  console.log('ログイン成功')

  // 必要なマスタデータを取得
  const { data: tables } = await supabase.from('tables').select('*').order('table_number')
  const { data: members } = await supabase.from('members').select('*').limit(5)
  const { data: menus } = await supabase.from('menu_items').select('*').eq('is_available', true)

  console.log(`台: ${tables.length}件, 会員: ${members.length}件, メニュー: ${menus.length}件`)

  const tbl = (n) => tables.find(t => t.table_number === n) || tables[n - 1]
  const menu = (name) => menus.find(m => m.name === name)

  const results = []

  // ===== ケース1: 一般・時間制（複数）・ドリンクあり (1台, 90分前開始) =====
  {
    const t = tbl(1)
    const { data: sess } = await supabase.from('sessions').insert({
      table_id: t.id,
      customer_type: 'general',
      pricing_type: 'hourly_multi',
      started_at: minsAgo(90),
      guest_name: null,
      member_id: null,
    }).select().single()

    await supabase.from('time_blocks').insert({ session_id: sess.id, started_at: minsAgo(90) })
    await supabase.from('order_items').insert([
      { session_id: sess.id, menu_item_id: menu('コーラ').id, quantity: 2, unit_price: menu('コーラ').price },
      { session_id: sess.id, menu_item_id: menu('ビール').id, quantity: 1, unit_price: menu('ビール').price },
    ])
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', t.id)
    results.push(`ケース1: 台${t.table_number} session=${sess.id}`)
  }

  // ===== ケース2: 女性・フリータイム・フード・取消しあり (2台) =====
  {
    const t = tbl(2)
    const { data: sess } = await supabase.from('sessions').insert({
      table_id: t.id,
      customer_type: 'female',
      pricing_type: 'freetime',
      started_at: minsAgo(60),
      guest_name: null,
      member_id: null,
    }).select().single()

    const { data: cola } = await supabase.from('order_items').insert({
      session_id: sess.id, menu_item_id: menu('コーラ').id, quantity: 1, unit_price: menu('コーラ').price
    }).select().single()
    await supabase.from('order_items').insert({
      session_id: sess.id, menu_item_id: menu('ナポリタン').id, quantity: 1, unit_price: menu('ナポリタン').price
    })
    // コーラを取消し
    await supabase.from('order_items').update({ cancelled_at: new Date().toISOString() }).eq('id', cola.id)
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', t.id)
    results.push(`ケース2: 台${t.table_number} session=${sess.id}`)
  }

  // ===== ケース3: 学生・時間制（一人）・45分 (3台) =====
  {
    const t = tbl(3)
    const { data: sess } = await supabase.from('sessions').insert({
      table_id: t.id,
      customer_type: 'student',
      pricing_type: 'hourly_single',
      started_at: minsAgo(45),
      guest_name: null,
      member_id: null,
    }).select().single()

    await supabase.from('time_blocks').insert({ session_id: sess.id, started_at: minsAgo(45) })
    await supabase.from('order_items').insert({
      session_id: sess.id, menu_item_id: menu('ウーロン茶').id, quantity: 1, unit_price: menu('ウーロン茶').price
    })
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', t.id)
    results.push(`ケース3: 台${t.table_number} session=${sess.id}`)
  }

  // ===== ケース4: 一般・時間制（複数）・開始時刻修正テスト (4台, 実際は60分前に設定) =====
  {
    const t = tbl(4)
    const { data: sess } = await supabase.from('sessions').insert({
      table_id: t.id,
      customer_type: 'general',
      pricing_type: 'hourly_multi',
      started_at: minsAgo(30), // 意図的に30分前、修正で60分前にする操作をUIでテスト
      guest_name: null,
      member_id: null,
    }).select().single()

    await supabase.from('time_blocks').insert({ session_id: sess.id, started_at: minsAgo(30) })
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', t.id)
    results.push(`ケース4: 台${t.table_number} session=${sess.id}`)
  }

  // ===== ケース5: 複数伝票（5台に2グループ） =====
  {
    const t = tbl(5)
    const { data: sess1 } = await supabase.from('sessions').insert({
      table_id: t.id,
      customer_type: 'general',
      pricing_type: 'hourly_multi',
      started_at: minsAgo(50),
      guest_name: 'グループA',
      member_id: null,
    }).select().single()
    await supabase.from('time_blocks').insert({ session_id: sess1.id, started_at: minsAgo(50) })

    const { data: sess2 } = await supabase.from('sessions').insert({
      table_id: t.id,
      customer_type: 'student',
      pricing_type: 'hourly_single',
      started_at: minsAgo(20),
      guest_name: 'グループB',
      member_id: null,
    }).select().single()
    await supabase.from('time_blocks').insert({ session_id: sess2.id, started_at: minsAgo(20) })
    await supabase.from('tables').update({ status: 'in_use' }).eq('id', t.id)
    results.push(`ケース5: 台${t.table_number} sess1=${sess1.id} sess2=${sess2.id}`)
  }

  // ===== ケース6: 会員選択あり (6台または1台目の次の空台) =====
  if (members.length > 0) {
    const member = members[0]
    const t = tbl(6) || tables.find(t => t.status === 'empty')
    if (t) {
      const { data: sess } = await supabase.from('sessions').insert({
        table_id: t.id,
        customer_type: member.customer_type,
        pricing_type: 'hourly_multi',
        started_at: minsAgo(75),
        member_id: member.id,
        guest_name: null,
      }).select().single()
      await supabase.from('time_blocks').insert({ session_id: sess.id, started_at: minsAgo(75) })
      await supabase.from('order_items').insert({
        session_id: sess.id, menu_item_id: menu('ビール').id, quantity: 1, unit_price: menu('ビール').price
      })
      await supabase.from('tables').update({ status: 'in_use' }).eq('id', t.id)
      results.push(`ケース6: 台${t.table_number} 会員=${member.name} session=${sess.id}`)
    } else {
      results.push('ケース6: 空台なし → スキップ')
    }
  } else {
    results.push('ケース6: 会員データなし → スキップ')
  }

  // ===== ケース7: 任意名前入力・女性・フリータイム (7台) =====
  {
    const t = tbl(7) || tables.find(t => t.status === 'empty')
    if (t) {
      const { data: sess } = await supabase.from('sessions').insert({
        table_id: t.id,
        customer_type: 'female',
        pricing_type: 'freetime',
        started_at: minsAgo(40),
        guest_name: '田中様',
        member_id: null,
      }).select().single()
      await supabase.from('order_items').insert({
        session_id: sess.id, menu_item_id: menu('コーラ').id, quantity: 1, unit_price: menu('コーラ').price
      })
      await supabase.from('tables').update({ status: 'in_use' }).eq('id', t.id)
      results.push(`ケース7: 台${t.table_number} guest=田中様 session=${sess.id}`)
    }
  }

  console.log('\n=== 挿入結果 ===')
  results.forEach(r => console.log(r))
}

run().catch(console.error)
