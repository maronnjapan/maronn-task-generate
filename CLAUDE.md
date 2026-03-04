# input-cycle-bot 実装仕様書（Claude Code 用）

> この仕様書は Claude Code に渡して実装させるためのドキュメントです。
> 上から順に実装してください。各ステップには実装すべきコード、テスト方法、完了条件が含まれています。

---

## プロジェクト概要

LINE Bot で音声/テキストのコンディション入力を受け取り、ルールベースでコンディションを判定し、
サブスク LLM（Claude/ChatGPT/Gemini）に貼るためのプロンプトを自動生成して返信する。

**Bot は LLM API を使わない。** 唯一の AI 使用箇所は音声文字起こし（Cloudflare Workers AI / Whisper、無料枠）のみ。

---

## 技術スタック

- **ランタイム**: Cloudflare Workers
- **フレームワーク**: Hono
- **言語**: TypeScript（strict mode）
- **DB**: Cloudflare D1（SQLite）
- **音声文字起こし**: Cloudflare Workers AI (`@cf/openai/whisper`)
- **メッセージング**: LINE Messaging API

---

## Step 0: プロジェクト初期化

```bash
npm create cloudflare@latest input-cycle-bot -- --template hono
cd input-cycle-bot
npm install hono
```

### wrangler.toml

```toml
name = "input-cycle-bot"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "input-cycle-bot-db"
database_id = ""  # wrangler d1 create 後に記入
```

### ディレクトリ構成

以下の構成で全ファイルを作成すること。

```
src/
├── index.ts
├── routes/
│   └── webhook.ts
├── services/
│   ├── line.ts
│   ├── transcribe.ts
│   ├── condition.ts
│   └── prompt-builder.ts
├── commands/
│   ├── router.ts
│   ├── record.ts
│   ├── blog.ts
│   └── history.ts
├── db/
│   ├── schema.sql
│   └── queries.ts
├── utils/
│   └── date.ts
└── types/
    └── index.ts
```

---

## Step 1: 型定義（`src/types/index.ts`）

```typescript
// --- LINE Webhook 型 ---

export type LineWebhookBody = {
  events: LineWebhookEvent[];
};

export type LineWebhookEvent = {
  type: "message" | "follow" | "unfollow" | string;
  replyToken: string;
  message: LineMessage;
};

export type LineMessage =
  | { type: "text"; text: string }
  | { type: "audio"; id: string; duration: number }
  | { type: string };

// --- DB 型 ---

export type DailyLog = {
  id: number;
  date: string;
  day_of_week: string;
  condition_level: number | null;
  condition_reason: string | null;
  input_text: string | null;
  summary: string | null;
  created_at: string;
};

export type BlogItem = {
  id: number;
  title: string;
  status: "backlog" | "researching" | "testing" | "writing" | "published";
  note: string | null;
  updated_at: string;
};

// --- コンディション判定 ---

export type ConditionLevel = 1 | 2 | 3 | 4 | 5;

export type ConditionResult = {
  level: ConditionLevel;
  reason: string;
  matchedKeywords: string[];
};

// --- Bindings ---

export type Bindings = {
  AI: Ai;
  DB: D1Database;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
};
```

---

## Step 2: DB スキーマ（`src/db/schema.sql`）

```sql
CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  day_of_week TEXT NOT NULL,
  condition_level INTEGER,
  condition_reason TEXT,
  input_text TEXT,
  summary TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);

CREATE TABLE IF NOT EXISTS blog_pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'backlog',
  note TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**注意**: `daily_logs.date` に UNIQUE 制約あり。同日の再入力は UPSERT で上書きする。

---

## Step 3: ユーティリティ（`src/utils/date.ts`）

JST（UTC+9）で日付・曜日を取得するヘルパー。

```typescript
const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * UTC の Date から JST の日付文字列を返す（例: "2026-03-04"）
 */
export function toJSTDateString(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * UTC の Date から JST の曜日を返す（例: "火"）
 */
export function toJSTDayOfWeek(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return DAY_NAMES[jst.getUTCDay()];
}

/**
 * UTC の Date から JST の時（0-23）を返す
 */
export function toJSTHour(date: Date): number {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours();
}
```

---

## Step 4: LINE API サービス（`src/services/line.ts`）

```typescript
/**
 * LINE Webhook の署名検証
 * X-Line-Signature ヘッダーの値と、チャネルシークレットで計算した HMAC-SHA256 を比較する。
 *
 * @param body - Webhook のリクエストボディ（生文字列）
 * @param signature - X-Line-Signature ヘッダーの値
 * @param channelSecret - LINE チャネルシークレット
 * @returns 署名が正しければ true
 */
export async function verifySignature(
  body: string,
  signature: string,
  channelSecret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

/**
 * LINE Content API で音声バイナリを取得する
 *
 * @param messageId - LINE メッセージ ID
 * @param accessToken - LINE チャネルアクセストークン
 * @returns 音声の ArrayBuffer
 */
export async function fetchAudioContent(
  messageId: string,
  accessToken: string
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch audio content: ${res.status} ${res.statusText}`);
  }
  return res.arrayBuffer();
}

/**
 * LINE Reply API でテキストメッセージを返信する。
 * LINE のテキストメッセージは5000文字制限があるため、超過時は分割して送信する。
 *
 * @param replyToken - LINE のリプライトークン
 * @param text - 返信するテキスト
 * @param accessToken - LINE チャネルアクセストークン
 */
export async function replyMessage(
  replyToken: string,
  text: string,
  accessToken: string
): Promise<void> {
  // LINE テキストメッセージの上限は 5000 文字
  // 長いプロンプトの場合は分割する（最大5バブルまで）
  const MAX_LENGTH = 5000;
  const chunks: string[] = [];

  if (text.length <= MAX_LENGTH) {
    chunks.push(text);
  } else {
    let remaining = text;
    while (remaining.length > 0 && chunks.length < 5) {
      chunks.push(remaining.slice(0, MAX_LENGTH));
      remaining = remaining.slice(MAX_LENGTH);
    }
  }

  const messages = chunks.map((chunk) => ({
    type: "text" as const,
    text: chunk,
  }));

  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`LINE reply failed: ${res.status} ${errorBody}`);
  }
}
```

---

## Step 5: 音声文字起こし（`src/services/transcribe.ts`）

```typescript
/**
 * Cloudflare Workers AI (Whisper) で音声を文字起こしする。
 *
 * @param ai - Workers AI バインディング
 * @param audioBuffer - 音声の ArrayBuffer
 * @returns 文字起こし結果のテキスト
 */
export async function transcribeAudio(
  ai: Ai,
  audioBuffer: ArrayBuffer
): Promise<string> {
  const result = await ai.run("@cf/openai/whisper", {
    audio: [...new Uint8Array(audioBuffer)],
  });
  return result.text ?? "";
}
```

---

## Step 6: コンディション判定（`src/services/condition.ts`）

ルールベースのキーワードスコアリング。LLM は使わない。

```typescript
import type { ConditionLevel, ConditionResult } from "../types";
import { toJSTHour } from "../utils/date";

const NEGATIVE_KEYWORDS: Record<string, number> = {
  "ぐったり": -2,
  "無理": -2,
  "限界": -2,
  "頭痛": -2,
  "寝たい": -2,
  "しんどすぎ": -2,
  "疲れ": -1,
  "しんどい": -1,
  "だるい": -1,
  "眠い": -1,
  "ミーティング多": -1,
  "残業": -1,
  "つらい": -1,
  "きつい": -1,
  "微妙": -1,
  "重い": -1,
};

const POSITIVE_KEYWORDS: Record<string, number> = {
  "めっちゃ元気": 2,
  "やる気": 2,
  "絶好調": 2,
  "最高": 2,
  "元気": 1,
  "いける": 1,
  "大丈夫": 1,
  "まあまあ": 1,
  "普通": 1,
  "悪くない": 1,
  "余裕": 1,
  "早く帰れた": 1,
};

/**
 * テキストからコンディションレベル（1-5）を判定する。
 * ベーススコアを 3 とし、キーワードマッチで加減算する。
 * 22時以降は -1 の時間帯補正あり。
 */
export function assessCondition(text: string): ConditionResult {
  const matched: string[] = [];
  let score = 0;

  // 長いキーワードから先にマッチさせるためソート
  const allKeywords = [
    ...Object.entries(NEGATIVE_KEYWORDS),
    ...Object.entries(POSITIVE_KEYWORDS),
  ].sort((a, b) => b[0].length - a[0].length);

  for (const [keyword, weight] of allKeywords) {
    if (text.includes(keyword)) {
      score += weight;
      matched.push(keyword);
    }
  }

  // 時間帯補正（JST 22時以降は -1）
  const hour = toJSTHour(new Date());
  if (hour >= 22) {
    score -= 1;
  }

  const rawLevel = Math.max(1, Math.min(5, 3 + score));
  const level = rawLevel as ConditionLevel;

  const reason =
    matched.length > 0
      ? `「${matched.join("」「")}」から判定`
      : "特にキーワードなし → デフォルト（普通）";

  return { level, reason, matchedKeywords: matched };
}
```

---

## Step 7: プロンプトビルダー（`src/services/prompt-builder.ts`）

Bot の核心機能。直近の履歴・ブログ状態・コンディションを組み合わせて、LLM に貼るプロンプトを生成する。

```typescript
import type { DailyLog, BlogItem } from "../types";

const CYCLE_MAP: Record<number, string> = {
  1: "1サイクル（10-15分）",
  2: "2サイクル（20-30分）",
  3: "3サイクル（30-45分）",
  4: "4サイクル（40-60分）",
  5: "5-6サイクル（60-90分）",
};

type BuildPromptParams = {
  condition: { level: number; reason: string };
  recentLogs: DailyLog[];
  blogPipeline: BlogItem[];
  currentDate: string;
  dayOfWeek: string;
};

/**
 * LLM に貼るためのプロンプトを生成する。
 * これが LINE で返信される本体。
 */
export function buildPrompt(params: BuildPromptParams): string {
  const { condition, recentLogs, blogPipeline, currentDate, dayOfWeek } = params;

  const cycles = CYCLE_MAP[condition.level] ?? "3サイクル（30-45分）";

  const historyText =
    recentLogs.length > 0
      ? recentLogs
          .map((log) => `  - ${log.date}（${log.day_of_week}）: ${log.summary}`)
          .join("\n")
      : "  - 履歴なし（今日が初回）";

  const pipelineText =
    blogPipeline.length > 0
      ? blogPipeline
          .map(
            (item) =>
              `  - [ID:${item.id}]「${item.title}」: ${item.status}${item.note ? `（${item.note}）` : ""}`
          )
          .join("\n")
      : "  - 現在進行中のテーマなし";

  return `あなたは学習コーチです。以下の情報をもとに、今日やるべきタスクを「サイクル」単位で提案してください。

## サイクルとは
- 1サイクル = 10〜20分で完結する学習タスク
- サイクル間に2-3分の休憩を挟んでもOK
- 各サイクルは独立して完結すること（途中で終わっても成果が残る）

## 今日の情報
- 日付: ${currentDate}（${dayOfWeek}）
- コンディション: ${condition.level}/5（${condition.reason}）
- 推奨: ${cycles}

## 直近の学習履歴
${historyText}

## 学習軸1: 受験勉強（数学・英語）
数学の単元: 二次関数、確率、微分積分、ベクトル、数列
英語の単元: 文法、長文読解、リスニング、単語・熟語
※ 履歴を見てバランスよく配分してください

## 学習軸2: 認証認可ブログ
${pipelineText}
パイプライン: 調査 → 検証 → 執筆 → 公開
※ 現在のステータスに応じて次のアクションを提案してください

## 提案ルール
- サイクル数はコンディションに応じて調整
- 各サイクルのタスクは10〜20分で完結する粒度に分解
- 2軸（受験勉強 / ブログ）の組み合わせはコンディションに応じて自由に判断
- コンディション1-2: 受動的タスク優先（読む・見る・復習）
- コンディション4-5: 能動的タスク優先（問題を解く・検証する・書く）
- 履歴を見て、最近やっていない教科やテーマを優先

## 出力フォーマット
📊 コンディション: {level}/5
🔄 サイクル数: {n}サイクル（合計 約{xx}分）

🔁 サイクル1（{xx}分）: {軸} - {具体的タスク}
🔁 サイクル2（{xx}分）: {軸} - {具体的タスク}
🔁 サイクル3（{xx}分）: {軸} - {具体的タスク}
...

💡 ひとこと: {一言アドバイス}`;
}

/**
 * LINE 返信用メッセージ全体を組み立てる。
 * ヘッダー（コンディション表示）+ プロンプト本文。
 */
export function buildLineResponse(params: BuildPromptParams): string {
  const { condition, currentDate, dayOfWeek } = params;
  const cycles = CYCLE_MAP[condition.level] ?? "3サイクル（30-45分）";
  const prompt = buildPrompt(params);

  return `📋 今日のコンテキスト（${currentDate} ${dayOfWeek}）
コンディション: ${condition.level}/5（${condition.reason}）
🔄 推奨: ${cycles}

以下を Claude 等に貼ってください👇
─────────────────
${prompt}
─────────────────`;
}
```

---

## Step 8: DB クエリ（`src/db/queries.ts`）

```typescript
import type { DailyLog, BlogItem } from "../types";

/**
 * 直近 N 件の学習記録を取得する（summary が入力済みのもののみ）。
 */
export async function getRecentLogs(
  db: D1Database,
  limit: number
): Promise<DailyLog[]> {
  const result = await db
    .prepare(
      `SELECT id, date, day_of_week, condition_level, summary
       FROM daily_logs
       WHERE summary IS NOT NULL
       ORDER BY date DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<DailyLog>();

  return result.results;
}

/**
 * 未公開のブログパイプラインを取得する。
 */
export async function getBlogPipeline(db: D1Database): Promise<BlogItem[]> {
  const result = await db
    .prepare(
      `SELECT id, title, status, note, updated_at
       FROM blog_pipeline
       WHERE status != 'published'
       ORDER BY updated_at DESC`
    )
    .all<BlogItem>();

  return result.results;
}

/**
 * 今日のコンディションログを保存する（UPSERT）。
 * 同日に複数回送信した場合は上書き。
 */
export async function saveDailyLog(
  db: D1Database,
  log: {
    date: string;
    dayOfWeek: string;
    conditionLevel: number;
    conditionReason: string;
    inputText: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO daily_logs (date, day_of_week, condition_level, condition_reason, input_text)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         condition_level = excluded.condition_level,
         condition_reason = excluded.condition_reason,
         input_text = excluded.input_text`
    )
    .bind(
      log.date,
      log.dayOfWeek,
      log.conditionLevel,
      log.conditionReason,
      log.inputText
    )
    .run();
}

/**
 * 学習記録のサマリーを更新する。
 * 「記録」コマンドで使用。今日のログに summary を追加/上書きする。
 */
export async function updateDailyLogSummary(
  db: D1Database,
  date: string,
  dayOfWeek: string,
  summary: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO daily_logs (date, day_of_week, summary)
       VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         summary = excluded.summary`
    )
    .bind(date, dayOfWeek, summary)
    .run();
}

/**
 * ブログテーマを追加する。
 */
export async function addBlogItem(
  db: D1Database,
  title: string
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO blog_pipeline (title) VALUES (?) RETURNING id`
    )
    .bind(title)
    .first<{ id: number }>();

  return result?.id ?? 0;
}

/**
 * ブログテーマのステータスを更新する。
 */
export async function updateBlogStatus(
  db: D1Database,
  id: number,
  status: string,
  note?: string
): Promise<boolean> {
  const validStatuses = ["backlog", "researching", "testing", "writing", "published"];
  if (!validStatuses.includes(status)) {
    return false;
  }

  const result = note !== undefined
    ? await db
        .prepare(
          `UPDATE blog_pipeline SET status = ?, note = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .bind(status, note, id)
        .run()
    : await db
        .prepare(
          `UPDATE blog_pipeline SET status = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .bind(status, id)
        .run();

  return result.meta.changes > 0;
}

/**
 * 全ブログテーマを取得する（公開済み含む）。
 */
export async function getAllBlogItems(db: D1Database): Promise<BlogItem[]> {
  const result = await db
    .prepare(
      `SELECT id, title, status, note, updated_at
       FROM blog_pipeline
       ORDER BY
         CASE status
           WHEN 'writing' THEN 1
           WHEN 'testing' THEN 2
           WHEN 'researching' THEN 3
           WHEN 'backlog' THEN 4
           WHEN 'published' THEN 5
         END,
         updated_at DESC`
    )
    .all<BlogItem>();

  return result.results;
}

/**
 * 直近 N 日分の学習記録を取得する（全件、summary なし含む）。
 */
export async function getRecentLogsAll(
  db: D1Database,
  limit: number
): Promise<DailyLog[]> {
  const result = await db
    .prepare(
      `SELECT id, date, day_of_week, condition_level, condition_reason, summary
       FROM daily_logs
       ORDER BY date DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<DailyLog>();

  return result.results;
}
```

---

## Step 9: コマンドハンドラ

### `src/commands/record.ts`

```typescript
import { toJSTDateString, toJSTDayOfWeek } from "../utils/date";
import { updateDailyLogSummary } from "../db/queries";

/**
 * 「記録」コマンドをパースする。
 * フォーマット: 「記録 <内容>」
 *
 * @returns 記録内容の文字列。コマンドでなければ null。
 */
export function parseRecord(text: string): string | null {
  const match = text.match(/^記録\s+(.+)$/s);
  return match ? match[1].trim() : null;
}

/**
 * 学習記録を保存し、確認メッセージを返す。
 */
export async function handleRecord(
  db: D1Database,
  content: string
): Promise<string> {
  const now = new Date();
  const date = toJSTDateString(now);
  const dayOfWeek = toJSTDayOfWeek(now);

  await updateDailyLogSummary(db, date, dayOfWeek, content);

  return `✅ 記録しました（${date} ${dayOfWeek}）\n${content}`;
}
```

### `src/commands/blog.ts`

```typescript
import {
  addBlogItem,
  updateBlogStatus,
  getAllBlogItems,
} from "../db/queries";

const STATUS_LABELS: Record<string, string> = {
  backlog: "📋 バックログ",
  researching: "🔍 調査中",
  testing: "🧪 検証中",
  writing: "✍️ 執筆中",
  published: "✅ 公開済",
};

/**
 * 「ブログ」コマンドを処理する。
 *
 * サブコマンド:
 * - ブログ一覧
 * - ブログ追加 <テーマ名>
 * - ブログ更新 <ID> <status> [メモ]
 */
export async function handleBlogCommand(
  db: D1Database,
  text: string
): Promise<string> {
  const trimmed = text.replace(/^ブログ\s*/, "");

  // ブログ一覧
  if (trimmed === "一覧" || trimmed === "") {
    const items = await getAllBlogItems(db);
    if (items.length === 0) {
      return "📋 ブログテーマはまだ登録されていません。\n「ブログ追加 テーマ名」で追加できます。";
    }
    const lines = items.map(
      (item) =>
        `${STATUS_LABELS[item.status] ?? item.status} [ID:${item.id}] ${item.title}${item.note ? `\n   📝 ${item.note}` : ""}`
    );
    return `📋 ブログパイプライン\n\n${lines.join("\n\n")}`;
  }

  // ブログ追加
  const addMatch = trimmed.match(/^追加\s+(.+)$/s);
  if (addMatch) {
    const title = addMatch[1].trim();
    const id = await addBlogItem(db, title);
    return `✅ ブログテーマを追加しました\n[ID:${id}] ${title}\nステータス: backlog`;
  }

  // ブログ更新
  const updateMatch = trimmed.match(/^更新\s+(\d+)\s+(backlog|researching|testing|writing|published)(?:\s+(.+))?$/s);
  if (updateMatch) {
    const id = parseInt(updateMatch[1], 10);
    const status = updateMatch[2];
    const note = updateMatch[3]?.trim();
    const success = await updateBlogStatus(db, id, status, note);
    if (success) {
      return `✅ ブログ [ID:${id}] を ${STATUS_LABELS[status] ?? status} に更新しました${note ? `\n📝 ${note}` : ""}`;
    }
    return `❌ ID:${id} のテーマが見つかりません。「ブログ一覧」で確認してください。`;
  }

  // ヘルプ
  return `📋 ブログコマンド:
  ブログ一覧
  ブログ追加 <テーマ名>
  ブログ更新 <ID> <status> [メモ]

  status: backlog / researching / testing / writing / published`;
}
```

### `src/commands/history.ts`

```typescript
import { getRecentLogsAll } from "../db/queries";

/**
 * 直近7日間の学習履歴を表示する。
 */
export async function handleHistory(db: D1Database): Promise<string> {
  const logs = await getRecentLogsAll(db, 7);

  if (logs.length === 0) {
    return "📊 まだ記録がありません。\n「記録 英語 単語15分」のように記録してみましょう。";
  }

  const lines = logs.map((log) => {
    const condition = log.condition_level
      ? ` (コンディション: ${log.condition_level}/5)`
      : "";
    const summary = log.summary ?? "（学習記録なし）";
    return `📅 ${log.date}（${log.day_of_week}）${condition}\n   ${summary}`;
  });

  return `📊 直近の学習履歴\n\n${lines.join("\n\n")}`;
}
```

### `src/commands/router.ts`

```typescript
import { parseRecord, handleRecord } from "./record";
import { handleBlogCommand } from "./blog";
import { handleHistory } from "./history";
import { assessCondition } from "../services/condition";
import { buildLineResponse } from "../services/prompt-builder";
import { getRecentLogs, getBlogPipeline, saveDailyLog } from "../db/queries";
import { toJSTDateString, toJSTDayOfWeek } from "../utils/date";

const HELP_TEXT = `📖 使い方

💬 コンディションを伝える
  音声 or テキストで今の状態を送信
  → LLM 用プロンプトを生成します

📝 学習を記録する
  記録 英語 長文読解15分
  記録 数学 二次関数15分

📋 ブログ管理
  ブログ一覧
  ブログ追加 テーマ名
  ブログ更新 [ID] [status] [メモ]
  ※ status: backlog/researching/testing/writing/published

📊 履歴を見る
  履歴`;

/**
 * テキストメッセージを受け取り、コマンド or コンディション入力として処理する。
 *
 * コマンド優先順位:
 * 1. 「記録 ...」→ 学習記録
 * 2. 「ブログ...」→ ブログパイプライン管理
 * 3. 「履歴」→ 直近の学習履歴
 * 4. 「ヘルプ」→ 使い方
 * 5. その他 → コンディション入力 → プロンプト生成
 */
export async function handleMessage(
  text: string,
  db: D1Database
): Promise<string> {
  // 「記録」コマンド
  const recordContent = parseRecord(text);
  if (recordContent) {
    return await handleRecord(db, recordContent);
  }

  // 「ブログ」コマンド
  if (text.startsWith("ブログ")) {
    return await handleBlogCommand(db, text);
  }

  // 「履歴」コマンド
  if (text === "履歴") {
    return await handleHistory(db);
  }

  // 「ヘルプ」コマンド
  if (text === "ヘルプ" || text === "help") {
    return HELP_TEXT;
  }

  // それ以外 → コンディション入力としてプロンプト生成
  return await handleConditionInput(db, text);
}

/**
 * コンディション入力を処理し、LLM 用プロンプトを生成して返す。
 */
async function handleConditionInput(
  db: D1Database,
  text: string
): Promise<string> {
  const condition = assessCondition(text);

  const recentLogs = await getRecentLogs(db, 7);
  const blogPipeline = await getBlogPipeline(db);

  const now = new Date();
  const currentDate = toJSTDateString(now);
  const dayOfWeek = toJSTDayOfWeek(now);

  // 今日のコンディションログを保存
  await saveDailyLog(db, {
    date: currentDate,
    dayOfWeek,
    conditionLevel: condition.level,
    conditionReason: condition.reason,
    inputText: text,
  });

  return buildLineResponse({
    condition,
    recentLogs,
    blogPipeline,
    currentDate,
    dayOfWeek,
  });
}
```

---

## Step 10: Webhook ルート（`src/routes/webhook.ts`）

```typescript
import { Hono } from "hono";
import type { Bindings, LineWebhookBody } from "../types";
import { verifySignature, fetchAudioContent, replyMessage } from "../services/line";
import { transcribeAudio } from "../services/transcribe";
import { handleMessage } from "../commands/router";

const webhook = new Hono<{ Bindings: Bindings }>();

webhook.post("/line", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("x-line-signature") ?? "";

  // 署名検証
  const valid = await verifySignature(
    body,
    signature,
    c.env.LINE_CHANNEL_SECRET
  );
  if (!valid) {
    return c.text("Invalid signature", 401);
  }

  const parsed: LineWebhookBody = JSON.parse(body);

  // 各イベントを処理（LINE は複数イベントを1リクエストで送る場合がある）
  for (const event of parsed.events) {
    if (event.type !== "message") continue;

    let userText: string;

    if (event.message.type === "audio") {
      try {
        const audioBuffer = await fetchAudioContent(
          event.message.id,
          c.env.LINE_CHANNEL_ACCESS_TOKEN
        );
        userText = await transcribeAudio(c.env.AI, audioBuffer);
        if (!userText.trim()) {
          await replyMessage(
            event.replyToken,
            "🎤 音声を認識できませんでした。もう一度送信するか、テキストで入力してください。",
            c.env.LINE_CHANNEL_ACCESS_TOKEN
          );
          continue;
        }
      } catch (error) {
        console.error("Audio transcription error:", error);
        await replyMessage(
          event.replyToken,
          "⚠️ 音声の処理中にエラーが発生しました。テキストで入力してください。",
          c.env.LINE_CHANNEL_ACCESS_TOKEN
        );
        continue;
      }
    } else if (event.message.type === "text") {
      userText = event.message.text;
    } else {
      // 画像・スタンプ等は無視
      continue;
    }

    try {
      const response = await handleMessage(userText, c.env.DB);
      await replyMessage(
        event.replyToken,
        response,
        c.env.LINE_CHANNEL_ACCESS_TOKEN
      );
    } catch (error) {
      console.error("Message handling error:", error);
      await replyMessage(
        event.replyToken,
        "⚠️ エラーが発生しました。もう一度お試しください。",
        c.env.LINE_CHANNEL_ACCESS_TOKEN
      );
    }
  }

  // LINE は常に 200 を返す必要がある（再送を防ぐため）
  return c.text("OK", 200);
});

export default webhook;
```

---

## Step 11: エントリポイント（`src/index.ts`）

```typescript
import { Hono } from "hono";
import type { Bindings } from "./types";
import webhook from "./routes/webhook";

const app = new Hono<{ Bindings: Bindings }>();

// ヘルスチェック
app.get("/", (c) => c.text("input-cycle-bot is running"));

// LINE Webhook
app.route("/webhook", webhook);

export default app;
```

---

## Step 12: テスト方法

### ローカルテスト

```bash
# D1 のローカルデータベース作成
wrangler d1 execute input-cycle-bot-db --local --file=src/db/schema.sql

# ローカル起動
wrangler dev

# curl でテスト（署名検証はスキップされないため、実際の LINE からのテストが必要）
# ただし GET / でヘルスチェックは可能
curl http://localhost:8787/
# → "input-cycle-bot is running"
```

### 単体テストすべき関数

以下の関数は純粋関数なのでユニットテスト可能。テストフレームワークは vitest を使用。

1. **`assessCondition(text)`** — 各種キーワードの組み合わせで期待するレベルが返ること
   - `"疲れた"` → level 2
   - `"めっちゃ元気"` → level 5
   - `"普通"` → level 4（ベース3 + 1）
   - `""` → level 3（デフォルト）
   - `"疲れたけどやる気ある"` → level 3（-1 + 2 = +1 → 4... ではなく、「疲れ」-1 + 「やる気」+2 = +1 → level 4）

2. **`parseRecord(text)`** — コマンドパース
   - `"記録 英語 単語15分"` → `"英語 単語15分"`
   - `"疲れた"` → `null`

3. **`buildPrompt(params)`** — プロンプトに必要な情報が含まれること

4. **`toJSTDateString(date)`** / **`toJSTDayOfWeek(date)`** — JST変換

---

## Step 13: デプロイ

```bash
# 1. D1 データベース作成（初回のみ）
wrangler d1 create input-cycle-bot-db
# → 出力された database_id を wrangler.toml に記入

# 2. テーブル作成（初回のみ）
wrangler d1 execute input-cycle-bot-db --file=src/db/schema.sql

# 3. Secrets 設定（初回のみ）
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put LINE_CHANNEL_SECRET

# 4. デプロイ
wrangler deploy

# 5. LINE Developers コンソールで Webhook URL を設定
# URL: https://input-cycle-bot.{your-subdomain}.workers.dev/webhook/line
# 「Webhookの利用」を ON にする
# 「応答メッセージ」を OFF にする
```

---

## Step 14: 初期データ投入

デプロイ後、ブログパイプラインの初期テーマを登録する。

```bash
wrangler d1 execute input-cycle-bot-db --command="INSERT INTO blog_pipeline (title, status) VALUES ('Auth0 Event Streams + EventBridge', 'testing');"
wrangler d1 execute input-cycle-bot-db --command="INSERT INTO blog_pipeline (title, status) VALUES ('CIBA フロー決済承認', 'backlog');"
```

または LINE Bot に以下を送信：
```
ブログ追加 Auth0 Event Streams + EventBridge
ブログ更新 1 testing
ブログ追加 CIBA フロー決済承認
```

---

## 制約・注意事項

1. **LINE Messaging API の無料プランは月200通まで。** Bot の返信1通 = 1カウント。1日6-7通が上限目安。
2. **LINE テキストメッセージは5000文字制限。** プロンプトが長い場合は分割送信する（実装済み）。
3. **Workers AI (Whisper) は LINE の m4a 音声をサポートしている。** 追加の変換処理は不要。
4. **D1 の `datetime('now')` は UTC。** 日付の比較やソートは JST 変換済みの `date` カラム（TEXT）で行う。
5. **LINE Webhook は必ず 200 を返すこと。** エラー時も 200 を返さないと LINE が再送を繰り返す。
