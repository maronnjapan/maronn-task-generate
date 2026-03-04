#!/usr/bin/env bash
set -euo pipefail

# ============================================
# input-cycle-bot 初回セットアップスクリプト
# ============================================
# 使い方: ./scripts/setup.sh
#
# 前提条件:
#   - Node.js がインストール済み
#   - wrangler login 済み（未ログインの場合は途中でブラウザが開きます）
#
# このスクリプトが行うこと:
#   1. npm install
#   2. wrangler ログイン確認
#   3. D1 データベース作成
#   4. wrangler.toml に database_id を自動書き込み
#   5. D1 テーブル作成（マイグレーション）
#   6. LINE Secrets の設定
#   7. 初回デプロイ
#   8. 初期データ投入
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

DB_NAME="input-cycle-bot-db"
WRANGLER="npx wrangler"

# --- ユーティリティ ---
info()  { echo -e "\033[1;34m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[1;32m[OK]\033[0m    $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $*"; exit 1; }

# --- 1. npm install ---
info "依存パッケージをインストール中..."
npm install --silent
ok "npm install 完了"

# --- 2. wrangler ログイン確認 ---
info "wrangler のログイン状態を確認中..."
if ! $WRANGLER whoami 2>/dev/null | grep -q "Account ID"; then
  warn "wrangler にログインしていません。ブラウザが開きます..."
  $WRANGLER login
fi
ok "wrangler ログイン済み"

# --- 3. D1 データベース作成 ---
info "D1 データベースを確認中..."

# 既存のDBがあるかチェック
EXISTING_DB_ID=$($WRANGLER d1 list --json 2>/dev/null | node -e "
  const data = require('fs').readFileSync('/dev/stdin', 'utf8');
  const dbs = JSON.parse(data);
  const db = dbs.find(d => d.name === '$DB_NAME');
  if (db) process.stdout.write(db.uuid);
" 2>/dev/null || true)

if [ -n "$EXISTING_DB_ID" ]; then
  ok "D1 データベース '$DB_NAME' は既に存在します (ID: $EXISTING_DB_ID)"
  DB_ID="$EXISTING_DB_ID"
else
  info "D1 データベース '$DB_NAME' を作成中..."
  CREATE_OUTPUT=$($WRANGLER d1 create "$DB_NAME" 2>&1)
  echo "$CREATE_OUTPUT"

  DB_ID=$(echo "$CREATE_OUTPUT" | grep -oP 'database_id\s*=\s*"\K[^"]+' || true)
  if [ -z "$DB_ID" ]; then
    # フォールバック: UUIDパターンで探す
    DB_ID=$(echo "$CREATE_OUTPUT" | grep -oP '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)
  fi

  if [ -z "$DB_ID" ]; then
    error "database_id を取得できませんでした。手動で wrangler.toml に記入してください。"
  fi
  ok "D1 データベース作成完了 (ID: $DB_ID)"
fi

# --- 4. wrangler.toml に database_id を書き込み ---
info "wrangler.toml に database_id を書き込み中..."
if grep -q 'database_id = ""' wrangler.toml; then
  sed -i "s|database_id = \"\".*|database_id = \"$DB_ID\"|" wrangler.toml
  ok "wrangler.toml 更新完了"
elif grep -q "database_id = \"$DB_ID\"" wrangler.toml; then
  ok "wrangler.toml は既に正しい database_id が設定されています"
else
  warn "wrangler.toml の database_id が既に別の値で設定されています。スキップします。"
fi

# --- 5. D1 テーブル作成 ---
info "D1 テーブルを作成中（リモート）..."
$WRANGLER d1 execute "$DB_NAME" --remote --file=src/db/schema.sql
ok "D1 マイグレーション完了"

# --- 6. LINE Secrets 設定 ---
info "LINE の Secrets を設定します"
echo ""

read -rp "LINE_CHANNEL_ACCESS_TOKEN を入力してください（スキップ: Enter）: " LINE_TOKEN
if [ -n "$LINE_TOKEN" ]; then
  echo "$LINE_TOKEN" | $WRANGLER secret put LINE_CHANNEL_ACCESS_TOKEN
  ok "LINE_CHANNEL_ACCESS_TOKEN 設定完了"
else
  warn "LINE_CHANNEL_ACCESS_TOKEN はスキップしました。後で wrangler secret put LINE_CHANNEL_ACCESS_TOKEN で設定してください。"
fi

read -rp "LINE_CHANNEL_SECRET を入力してください（スキップ: Enter）: " LINE_SECRET
if [ -n "$LINE_SECRET" ]; then
  echo "$LINE_SECRET" | $WRANGLER secret put LINE_CHANNEL_SECRET
  ok "LINE_CHANNEL_SECRET 設定完了"
else
  warn "LINE_CHANNEL_SECRET はスキップしました。後で wrangler secret put LINE_CHANNEL_SECRET で設定してください。"
fi

# --- 7. デプロイ ---
echo ""
info "Cloudflare Workers にデプロイ中..."
DEPLOY_OUTPUT=$($WRANGLER deploy 2>&1)
echo "$DEPLOY_OUTPUT"

WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oP 'https://[^\s]+workers\.dev' | head -1 || true)
ok "デプロイ完了"

# --- 8. 初期データ投入 ---
info "ブログパイプラインの初期データを投入中..."
$WRANGLER d1 execute "$DB_NAME" --remote --command="INSERT OR IGNORE INTO blog_pipeline (title, status) VALUES ('Auth0 Event Streams + EventBridge', 'testing');"
$WRANGLER d1 execute "$DB_NAME" --remote --command="INSERT OR IGNORE INTO blog_pipeline (title, status) VALUES ('CIBA フロー決済承認', 'backlog');"
ok "初期データ投入完了"

# --- 完了 ---
echo ""
echo "============================================"
echo -e "\033[1;32m セットアップ完了!\033[0m"
echo "============================================"
echo ""
if [ -n "${WORKER_URL:-}" ]; then
  echo "  Worker URL: $WORKER_URL"
  echo "  Webhook URL: ${WORKER_URL}/webhook/line"
  echo ""
  echo "  LINE Developers コンソールで以下を設定してください:"
  echo "    1. Webhook URL: ${WORKER_URL}/webhook/line"
  echo "    2. 「Webhookの利用」を ON"
  echo "    3. 「応答メッセージ」を OFF"
else
  echo "  Worker URL は wrangler deploy の出力を確認してください"
  echo "  Webhook URL: https://input-cycle-bot.<your-subdomain>.workers.dev/webhook/line"
fi
echo ""
echo "  ローカル開発: npm run dev"
echo "  テスト実行:   npm test"
echo "  再デプロイ:   npm run deploy"
echo ""
