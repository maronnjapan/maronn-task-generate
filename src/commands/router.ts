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
