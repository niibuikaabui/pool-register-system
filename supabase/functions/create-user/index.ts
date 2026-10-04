// 管理者がスタッフ/管理者ユーザーを作成するための Edge Function。
// Supabase の「Allow new users to sign up」を OFF にしたまま、
// 管理者だけが service_role 権限でユーザーを作成できるようにする。
//
// デプロイ: supabase functions deploy create-user --no-verify-jwt
// （呼び出し元の JWT は関数内で検証する）
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // 呼び出し元が管理者か確認
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'ログインが必要です' }, 401)
  const { data: caller, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller?.user) return json({ error: 'ログインが必要です' }, 401)

  const { data: profile } = await admin
    .from('user_profiles').select('role').eq('id', caller.user.id).maybeSingle()
  if (profile?.role !== 'admin') return json({ error: '管理者のみユーザーを登録できます' }, 403)

  // 入力チェック
  let body: { name?: string; email?: string; password?: string; role?: string }
  try { body = await req.json() } catch { return json({ error: '不正なリクエストです' }, 400) }
  const name = (body.name ?? '').trim()
  const email = (body.email ?? '').trim()
  const password = body.password ?? ''
  const role = body.role
  if (!name) return json({ error: '名前を入力してください' }, 400)
  if (!email) return json({ error: 'メールアドレスを入力してください' }, 400)
  if (password.length < 6) return json({ error: 'パスワードは6文字以上で入力してください' }, 400)
  if (role !== 'staff' && role !== 'admin') return json({ error: '権限が不正です' }, 400)

  // ユーザー作成（メール確認済みとして作成し、すぐログインできるようにする）
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (createError || !created?.user) {
    return json({ error: createError?.message ?? 'ユーザー作成に失敗しました' }, 400)
  }

  const { error: profileError } = await admin
    .from('user_profiles').insert({ id: created.user.id, name, role, email })
  if (profileError) {
    // プロフィール登録に失敗したら作成した認証ユーザーを取り消す
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: 'プロフィール登録エラー: ' + profileError.message }, 500)
  }

  return json({ id: created.user.id })
})
