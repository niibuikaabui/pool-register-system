import { createClient } from '@supabase/supabase-js'

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

const { error: loginError } = await sb.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
})
if (loginError) { console.error('ログインエラー:', loginError.message); process.exit(1) }

const { data: existing } = await sb.from('menu_items').select('sort_order').order('sort_order', { ascending: false }).limit(1)
let order = (existing?.[0]?.sort_order ?? 0) + 1

const items = [
  ['ウォッカトニック', 450],
  ['モスコミュール', 450],
  ['スクリュードライバー', 450],
  ['ブルドッグ', 450],
  ['ジントニック', 450],
  ['ジンバック', 450],
  ['ジンライム', 450],
  ['ジンフィズ', 450],
  ['ジンリッキー', 450],
  ['オレンジブロッサム', 450],
  ['ラムトニック', 450],
  ['ラムコーク', 450],
  ['ラムバック', 450],
  ['テキーラトニック', 450],
  ['テキーラサンライズ', 450],
  ['テキーラサンセット', 450],
  ['ピーチフィズ', 450],
  ['ピーチウーロン', 450],
  ['ファジーネーブル', 450],
  ['梅酒ロック', 450],
  ['梅酒ソーダ', 450],
  ['カシスオレンジ', 450],
  ['カシスソーダ', 450],
  ['カシスウーロン', 450],
  ['カシスミルク', 500],
  ['カンパリソーダ', 450],
  ['カンパリオレンジ', 450],
  ['カンパリグレープ', 450],
  ['カンパリトニック', 450],
  ['カルアミルク', 500],
  ['マリブコーク', 450],
  ['マリブミルク', 500],
  ['マリブオレンジ', 450],
  ['マリブグレープ', 450],
  ['金麦（缶）', 400],
  ['アサヒ（缶）', 400],
  ['アサヒ（小瓶）', 450],
  ['アサヒ（中瓶）', 550],
  ['レッドアイ', 500],
  ['シャンディーガフ', 500],
  ['コークサワー', 450],
  ['白ぶどうサワー', 450],
  ['レモンサワー', 450],
  ['デカビタサワー', 450],
  ['アセロラサワー', 450],
  ['パインサワー', 450],
  ['杏子サワー', 450],
  ['白桃サワー', 450],
  ['ウーロンハイ', 450],
  ['緑茶ハイ', 450],
  ['さんぴんハイ', 450],
  ['スミノフ', 500],
  ['ジーマ', 500],
  ['スカイブルー', 500],
  ['コロナ', 500],
  ['JACK DANIELS', 600],
  ['CHIVAS REGAL', 600],
  ['WILD TURKEY', 600],
  ['残波（黒）', 2500],
  ['菊の露ブラウン', 2500],
  ['菊の露VIP', 3600],
  ['夢航海', 2500],
  ['久米仙ブラウン', 2500],
  ['赤霧島', 2500],
  ['ハイボール', 450],
  ['ジンジャーハイボール', 450],
  ['ショット各種', 500],
]

const rows = items.map(([name, price]) => ({
  name,
  price,
  category: 'alcohol',
  is_available: true,
  sort_order: order++,
}))

const { error } = await sb.from('menu_items').insert(rows)
if (error) { console.error('挿入エラー:', error.message); process.exit(1) }
console.log(`✓ ${rows.length}件のアルコールメニューを登録しました`)
