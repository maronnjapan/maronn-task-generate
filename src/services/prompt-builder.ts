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

export type { BuildPromptParams };

/**
 * LLM に貼るためのプロンプトを生成する。
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
