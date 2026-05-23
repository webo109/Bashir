import { describe, it, expect } from "vitest";
import { muscatTodayStart, greetingPeriod } from "../lib/time";

describe("muscatTodayStart", () => {
  it("returns ISO string for 00:00 Muscat on the date that contains `now`", () => {
    // Muscat is UTC+4 with no DST. 2026-05-24 03:30 UTC = 07:30 Muscat -> today is 2026-05-24.
    const now = new Date("2026-05-24T03:30:00Z");
    expect(muscatTodayStart(now)).toBe("2026-05-23T20:00:00.000Z");
    // 2026-05-24 00:00 Muscat == 2026-05-23 20:00 UTC.
  });

  it("rolls correctly when Muscat clock has crossed midnight but UTC has not", () => {
    // 2026-05-23 22:30 UTC = 2026-05-24 02:30 Muscat -> today is 2026-05-24.
    const now = new Date("2026-05-23T22:30:00Z");
    expect(muscatTodayStart(now)).toBe("2026-05-23T20:00:00.000Z");
  });
});

describe("greetingPeriod", () => {
  it("returns 'morning' before 12:00 Muscat", () => {
    expect(greetingPeriod(new Date("2026-05-24T07:00:00Z"))).toBe("morning"); // 11:00 Muscat
  });
  it("returns 'afternoon' from 12:00 until 18:00 Muscat", () => {
    expect(greetingPeriod(new Date("2026-05-24T08:00:00Z"))).toBe("afternoon"); // 12:00
    expect(greetingPeriod(new Date("2026-05-24T13:59:00Z"))).toBe("afternoon"); // 17:59
  });
  it("returns 'evening' from 18:00 onward Muscat", () => {
    expect(greetingPeriod(new Date("2026-05-24T14:00:00Z"))).toBe("evening"); // 18:00
  });
});
