import { describe, it, expect } from "vitest";
import { parseRecord } from "../commands/record";

describe("parseRecord", () => {
  it("「記録 英語 単語15分」→ 「英語 単語15分」", () => {
    expect(parseRecord("記録 英語 単語15分")).toBe("英語 単語15分");
  });

  it("「記録 数学 二次関数15分」→ 「数学 二次関数15分」", () => {
    expect(parseRecord("記録 数学 二次関数15分")).toBe("数学 二次関数15分");
  });

  it("「疲れた」→ null（コマンドではない）", () => {
    expect(parseRecord("疲れた")).toBeNull();
  });

  it("「記録」のみ（内容なし）→ null", () => {
    expect(parseRecord("記録")).toBeNull();
  });

  it("改行を含む記録内容もパースできる", () => {
    expect(parseRecord("記録 英語 単語15分\n数学 10分")).toBe(
      "英語 単語15分\n数学 10分"
    );
  });
});
