# デプロイ手順書

`npm run setup`（`scripts/setup.sh`）で自動化されている作業と、**スクリプトでは自動化できない手動作業**をまとめます。

---

## 前提条件（事前に済ませておくこと）

| 項目 | 確認方法 |
|------|---------|
| Node.js インストール済み | `node -v` |
| Cloudflare アカウント作成済み | [dash.cloudflare.com](https://dash.cloudflare.com) |
| LINE Developers アカウント作成済み | [developers.line.biz](https://developers.line.biz) |
| wrangler ログイン済み | `npx wrangler whoami` |

---

## 手動作業 1: LINE チャネルの作成（初回のみ）

スクリプト実行前に LINE Developers コンソールで以下を設定してください。

1. [LINE Developers コンソール](https://developers.line.biz/console/) にログイン
2. 「プロバイダー」を作成（未作成の場合）
3. 「Messaging API チャネル」を新規作成
4. チャネル作成後、以下の値を控えておく

| 値 | 場所 |
|----|------|
| **Channel Secret** | チャネル基本設定 → チャネルシークレット |
| **Channel Access Token** | Messaging API設定 → チャネルアクセストークン（長期）→「発行」ボタン |

> これらの値は後のスクリプト実行中（ステップ6）で入力を求められます。

---

## 自動化されている作業（`npm run setup` の内容）

```bash
npm run setup
# または
bash scripts/setup.sh
```

スクリプトは以下を順番に実行します。

| ステップ | 内容 |
|---------|------|
| 1 | `npm install` — 依存パッケージのインストール |
| 2 | wrangler ログイン確認（未ログインの場合はブラウザが開く） |
| 3 | D1 データベース `input-cycle-bot-db` の作成（既存の場合はスキップ） |
| 4 | `wrangler.toml` の `database_id` を自動書き込み |
| 5 | `src/db/schema.sql` をリモート D1 に適用（テーブル作成） |
| 6 | `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` の Secret 登録（対話式） |
| 7 | `wrangler deploy` — Cloudflare Workers へのデプロイ |
| 8 | ブログパイプラインの初期データ投入 |

---

## 手動作業 2: LINE Webhook URL の設定（初回デプロイ後）

`npm run setup` 完了後、ターミナルに表示された Worker URL を使って LINE 側を設定します。

```
Worker URL:   https://input-cycle-bot.<your-subdomain>.workers.dev
Webhook URL:  https://input-cycle-bot.<your-subdomain>.workers.dev/webhook/line
```

1. [LINE Developers コンソール](https://developers.line.biz/console/) を開く
2. 作成した Messaging API チャネルを選択
3. 「Messaging API設定」タブを開く
4. 以下を設定する

| 設定項目 | 値 |
|---------|-----|
| Webhook URL | `https://input-cycle-bot.<your-subdomain>.workers.dev/webhook/line` |
| Webhookの利用 | **ON** |
| 応答メッセージ | **OFF** |
| あいさつメッセージ | **OFF**（任意） |

5. 「検証」ボタンをクリックして `200 OK` が返ることを確認する

---

## 再デプロイ（コード変更後）

```bash
npm run deploy
# または
npx wrangler deploy
```

> D1 や Secrets の再設定は不要です。コードのみ更新されます。

---

## ローカル開発

```bash
# ローカル D1 の初期化（初回のみ）
npx wrangler d1 execute input-cycle-bot-db --local --file=src/db/schema.sql

# ローカルサーバー起動
npm run dev
# → http://localhost:8787

# ヘルスチェック確認
curl http://localhost:8787/
# → "input-cycle-bot is running"
```

> ローカル環境では LINE からの実際のリクエストが届かないため、Webhook の動作確認は `wrangler deploy` 後に行ってください。

---

## テスト・型チェック

```bash
# ユニットテスト
npm test

# 型チェック
npm run typecheck
```

---

## トラブルシューティング

### `database_id` の取得に失敗した場合

```bash
# DB の ID を手動で確認
npx wrangler d1 list

# wrangler.toml を手動で編集
# database_id = ""  → database_id = "<確認したID>"
```

### Secrets を後から設定したい場合

```bash
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
```

### LINE Webhook の検証が失敗する場合

- Worker URL が正しいか確認（`https://` で始まるか）
- `wrangler deploy` が成功しているか確認
- `LINE_CHANNEL_SECRET` が正しく設定されているか確認

```bash
npx wrangler secret list
```
