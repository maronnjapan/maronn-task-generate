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
