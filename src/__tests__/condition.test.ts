import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assessCondition } from "../services/condition";

describe("assessCondition", () => {
  beforeEach(() => {
    // テスト中は JST 12:00（UTC 03:00）に固定して時間帯補正を無効化
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T03:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("空文字列 → level 3（デフォルト）", () => {
    const result = assessCondition("");
    expect(result.level).toBe(3);
    expect(result.matchedKeywords).toHaveLength(0);
  });

  it("「疲れた」→ level 2（ベース3 + 疲れ-1 = 2）", () => {
    const result = assessCondition("疲れた");
    expect(result.level).toBe(2);
    expect(result.matchedKeywords).toContain("疲れ");
  });

  it("「めっちゃ元気」→ level 5（ベース3 + 2 = 5）", () => {
    const result = assessCondition("めっちゃ元気");
    expect(result.level).toBe(5);
    expect(result.matchedKeywords).toContain("めっちゃ元気");
  });

  it("「普通」→ level 4（ベース3 + 1 = 4）", () => {
    const result = assessCondition("普通");
    expect(result.level).toBe(4);
    expect(result.matchedKeywords).toContain("普通");
  });

  it("「疲れたけどやる気ある」→ level 4（疲れ-1 + やる気+2 = +1）", () => {
    const result = assessCondition("疲れたけどやる気ある");
    expect(result.level).toBe(4);
    expect(result.matchedKeywords).toContain("疲れ");
    expect(result.matchedKeywords).toContain("やる気");
  });

  it("強いネガティブキーワードで level 1 にクランプ", () => {
    const result = assessCondition("ぐったりで頭痛が限界で無理");
    expect(result.level).toBe(1);
  });

  it("強いポジティブキーワードで level 5 にクランプ", () => {
    const result = assessCondition("めっちゃ元気で絶好調でやる気もある最高");
    expect(result.level).toBe(5);
  });
});

describe("assessCondition - 時間帯補正", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("22時以降は -1 補正がかかる", () => {
    vi.useFakeTimers();
    // UTC 13:00 → JST 22:00
    vi.setSystemTime(new Date("2026-03-04T13:00:00Z"));

    const result = assessCondition("");
    // ベース3 + 時間帯補正-1 = 2
    expect(result.level).toBe(2);
  });
});
