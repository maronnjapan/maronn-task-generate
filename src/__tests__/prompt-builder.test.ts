import { describe, it, expect } from "vitest";
import { buildPrompt, type BuildPromptParams } from "../services/prompt-builder";

describe("buildPrompt", () => {
  const baseParams: BuildPromptParams = {
    condition: { level: 3, reason: "特にキーワードなし → デフォルト（普通）" },
    recentLogs: [],
    blogPipeline: [],
    currentDate: "2026-03-04",
    dayOfWeek: "水",
  };

  it("基本的なプロンプトが生成される", () => {
    const prompt = buildPrompt(baseParams);
    expect(prompt).toContain("学習コーチ");
    expect(prompt).toContain("2026-03-04");
    expect(prompt).toContain("水");
    expect(prompt).toContain("3/5");
    expect(prompt).toContain("3サイクル（30-45分）");
  });

  it("履歴なしの場合、デフォルトテキストが含まれる", () => {
    const prompt = buildPrompt(baseParams);
    expect(prompt).toContain("履歴なし（今日が初回）");
  });

  it("履歴ありの場合、履歴が含まれる", () => {
    const params: BuildPromptParams = {
      ...baseParams,
      recentLogs: [
        {
          id: 1,
          date: "2026-03-03",
          day_of_week: "火",
          condition_level: 4,
          condition_reason: null,
          input_text: null,
          summary: "英語 単語15分、数学 二次関数15分",
          created_at: "",
        },
      ],
    };
    const prompt = buildPrompt(params);
    expect(prompt).toContain("2026-03-03（火）");
    expect(prompt).toContain("英語 単語15分、数学 二次関数15分");
  });

  it("ブログパイプラインが含まれる", () => {
    const params: BuildPromptParams = {
      ...baseParams,
      blogPipeline: [
        {
          id: 1,
          title: "Auth0テスト",
          status: "testing",
          note: "検証中",
          updated_at: "",
        },
      ],
    };
    const prompt = buildPrompt(params);
    expect(prompt).toContain("Auth0テスト");
    expect(prompt).toContain("testing");
  });

  it("コンディション 1 → 1サイクル（10-15分）", () => {
    const params: BuildPromptParams = {
      ...baseParams,
      condition: { level: 1, reason: "テスト" },
    };
    const prompt = buildPrompt(params);
    expect(prompt).toContain("1サイクル（10-15分）");
  });

  it("コンディション 5 → 5-6サイクル（60-90分）", () => {
    const params: BuildPromptParams = {
      ...baseParams,
      condition: { level: 5, reason: "テスト" },
    };
    const prompt = buildPrompt(params);
    expect(prompt).toContain("5-6サイクル（60-90分）");
  });
});
