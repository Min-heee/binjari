import { describe, expect, it } from "vitest";
import { parseInstant } from "@/core/calendar";
import { parseFeed, readFeed } from "./feed";

/**
 * 바깥 입력(feed.js)의 모양 검사. 틀리면 기본값(샘플의원)으로 넘어가지 않고 멈춰야 한다(F2와 같은 원칙).
 * 한창구가 /binjari/feed.js로 이 모양을 내보낸다.
 */

const good = {
  v: 1,
  now: "2026-10-22T22:28:00+09:00",
  clinicName: "데모성형외과",
  sourceLabel: "CRM 예약",
  bookings: { bookings: [{ id: "A1", service: "first-consult", date: "2026-10-23", start: "10:00" }], exceptions: [] },
};

describe("parseFeed", () => {
  it("맞는 모양이면 기준 시각·의원 이름·예약을 그대로 넘긴다", () => {
    const r = parseFeed(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.feed.nowMs).toBe(parseInstant("2026-10-22T22:28:00+09:00"));
    expect([r.feed.clinicName, r.feed.sourceLabel]).toEqual(["데모성형외과", "CRM 예약"]);
    expect(r.feed.bookings).toEqual(good.bookings);
  });

  it.each([
    [{ ...good, extra: 1 }, "feed 모르는 키입니다: extra"],
    [{ ...good, v: 2 }, "feed 판이 다릅니다: 2"],
    [{ ...good, now: "2026-10-22T22:28:00" }, "feed.now는 +09:00이 붙은 ISO 시각이어야 합니다"],
    [{ ...good, now: "2026-10-22T13:28:00Z" }, "feed.now는 +09:00이 붙은 ISO 시각이어야 합니다"],
    [{ ...good, now: "2026-10-22T22:28:00.123456+09:00" }, "feed.now는 +09:00이 붙은 ISO 시각이어야 합니다"],
    [{ ...good, clinicName: " " }, "feed.clinicName가 비었습니다"],
    [{ v: 1, now: good.now, clinicName: "a", sourceLabel: "b" }, "feed.bookings가 없습니다"],
  ])("틀린 모양은 이유와 함께 멈춘다 (%#)", (raw, error) => {
    const r = parseFeed(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain(error);
  });

  it("객체가 아니면 멈춘다", () => {
    expect(parseFeed(null)).toEqual({ ok: false, errors: ["feed가 객체가 아닙니다"] });
    expect(parseFeed([good])).toEqual({ ok: false, errors: ["feed가 객체가 아닙니다"] });
  });
});

describe("readFeed", () => {
  it("서버(빌드)에서는 읽지 않는다 — 미리 그리는 HTML은 기본 번들로", () => {
    expect(readFeed()).toBeNull();
  });
});
