#!/bin/sh
# 秘密情報（JWT/APIキー・パスワード直書き）や他プロジェクトの設定混入を防ぐガード。
#
# 経緯:
# - 2026-07-04: 複数プロジェクトを同一Claude Codeセッションで開いた際に、無関係な別プロジェクト
#   （例: competition-management-system）向けのBash許可コマンドや、生のSupabase
#   service_roleキー・JWTトークンが .claude 配下に混入する事故が発生 → .claude/settings*.json
#   限定のチェックを追加。
# - 2026-08-30: scripts/generate_member_pdf.py に service_role キー（JWT）が直書きされているのを
#   発見（.claude 配下限定のチェックでは検知できなかった）→ 全ステージファイルを対象に
#   JWT/新形式secretキーのパターンを検知するチェックを追加。
#
# インストール: このファイルを .git/hooks/pre-commit にコピーし実行権限を付与する。
#   cp scripts/pre-commit-hook.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# このプロジェクト自身のSupabase project ref（誤検知しないための許可リスト）
OWN_SUPABASE_REF="ggedrhvdqpaorkklpdcw"

# このファイル自身は検知用の正規表現テキストを含むため対象外にする
SELF_PATH="scripts/pre-commit-hook.sh"

fail=0

ALL_STAGED=$(git diff --cached --name-only --diff-filter=ACM || true)

# ── 1. 全ステージファイル共通: JWT/新形式secretキーの直書き検知 ──────────────
for f in $ALL_STAGED; do
  [ "$f" = "$SELF_PATH" ] && continue
  case "$f" in
    *.png|*.jpg|*.jpeg|*.gif|*.ico|*.pdf|*.ttf|*.ttc|*.woff|*.woff2) continue ;;
  esac

  content=$(git show ":$f" 2>/dev/null || true)
  [ -z "$content" ] && continue

  if echo "$content" | grep -qE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'; then
    echo "pre-commit: $f にJWT/APIトークンらしき文字列が含まれています。コミットを中止しました。" >&2
    fail=1
  fi

  if echo "$content" | grep -qE 'sb_secret_[A-Za-z0-9_-]+'; then
    echo "pre-commit: $f にSupabaseのsecret key（sb_secret_...）らしき文字列が含まれています。コミットを中止しました。" >&2
    fail=1
  fi
done

# ── 2. scripts/ 配下のコードでパスワード直書き検知 ───────────────────────────
for f in $ALL_STAGED; do
  [ "$f" = "$SELF_PATH" ] && continue
  case "$f" in
    scripts/*.js|scripts/*.mjs|scripts/*.py) ;;
    *) continue ;;
  esac

  # コメント行（// や # で始まる行）は使用例のプレースホルダーを書くことが多いため対象外
  content=$(git show ":$f" 2>/dev/null | grep -vE '^[[:space:]]*(//|#)' || true)
  [ -z "$content" ] && continue

  if echo "$content" | grep -qiE "password['\"]?[[:space:]]*[:=][[:space:]]*['\"][^'\"]{6,}['\"]"; then
    echo "pre-commit: $f にパスワードの直書きらしき記述が含まれています。環境変数を使ってください。コミットを中止しました。" >&2
    fail=1
  fi
done

# ── 3. .claude/settings*.json 限定: 他プロジェクト情報の混入検知（既存） ────
STAGED_SETTINGS=$(echo "$ALL_STAGED" | grep -E '^\.claude/settings(\.local)?\.json$' || true)

if [ -n "$STAGED_SETTINGS" ]; then
  for f in $STAGED_SETTINGS; do
    content=$(git show ":$f" 2>/dev/null || true)

    if echo "$content" | grep -qi 'service_role'; then
      echo "pre-commit: $f に 'service_role' というキーワードが含まれています。コミットを中止しました。" >&2
      fail=1
    fi

    foreign_ref=$(echo "$content" | grep -oE '[a-z0-9]{20}\.supabase\.co' | grep -v "${OWN_SUPABASE_REF}.supabase.co" | sort -u || true)
    if [ -n "$foreign_ref" ]; then
      echo "pre-commit: $f に本プロジェクト以外のSupabase project refが含まれています: $(echo "$foreign_ref" | tr '\n' ' ')" >&2
      fail=1
    fi

    foreign_path=$(echo "$content" | grep -oE 'claude-cowork[\\/]+[A-Za-z0-9_-]+' | grep -vi 'pool_register_system' | sort -u || true)
    if [ -n "$foreign_path" ]; then
      echo "pre-commit: $f に他プロジェクトらしきパスが含まれています: $(echo "$foreign_path" | tr '\n' ' ')" >&2
      fail=1
    fi
  done
fi

if [ "$fail" -eq 1 ]; then
  echo "" >&2
  echo "→ 意図した変更であれば該当箇所を確認・削除してから再度コミットしてください。" >&2
  exit 1
fi

exit 0
