import { describe, it, expect } from "vitest";
import { toJSTDateString, toJSTDayOfWeek, toJSTHour } from "../utils/date";

describe("toJSTDateString", () => {
  it("UTC 15:00 は JST 翌日 0:00 → 翌日の日付を返す", () => {
    const date = new Date("2026-03-04T15:00:00Z");
    expect(toJSTDateString(date)).toBe("2026-03-05");
  });

  it("UTC 00:00 は JST 09:00 → 同日の日付を返す", () => {
    const date = new Date("2026-03-04T00:00:00Z");
    expect(toJSTDateString(date)).toBe("2026-03-04");
  });

  it("UTC 14:59 は JST 23:59 → 同日の日付を返す", () => {
    const date = new Date("2026-03-04T14:59:00Z");
    expect(toJSTDateString(date)).toBe("2026-03-04");
  });
});

describe("toJSTDayOfWeek", () => {
  it("2026-03-04 (水) の曜日を正しく返す", () => {
    // 2026-03-04 は水曜日
    const date = new Date("2026-03-04T00:00:00Z");
    expect(toJSTDayOfWeek(date)).toBe("水");
  });

  it("日付境界をまたぐ場合、JST の曜日を返す", () => {
    // UTC 2026-03-04 15:00 → JST 2026-03-05 00:00 (木曜日)
    const date = new Date("2026-03-04T15:00:00Z");
    expect(toJSTDayOfWeek(date)).toBe("木");
  });
});

describe("toJSTHour", () => {
  it("UTC 00:00 → JST 9時", () => {
    const date = new Date("2026-03-04T00:00:00Z");
    expect(toJSTHour(date)).toBe(9);
  });

  it("UTC 13:00 → JST 22時", () => {
    const date = new Date("2026-03-04T13:00:00Z");
    expect(toJSTHour(date)).toBe(22);
  });

  it("UTC 15:00 → JST 0時", () => {
    const date = new Date("2026-03-04T15:00:00Z");
    expect(toJSTHour(date)).toBe(0);
  });
});
