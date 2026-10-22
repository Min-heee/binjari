import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/core/calendar";

/**
 * 품기 빌드(NEXT_PUBLIC_BINJARI_FEED=1)에서 화면이 쓰는 값. 브라우저의 window.__BINJARI_FEED__를 흉내 낸다.
 * 바깥 입력이 없거나 틀리면 샘플의원 값으로 조용히 넘어가지 않아야 한다(F2).
 */

const g = globalThis as Record<string, unknown>;
const feed = (now: string, bookings: unknown[] = []) => ({ v: 1, now, clinicName: "데모성형외과", sourceLabel: "CRM 예약 1건", bookings: { bookings, exceptions: [] } });

async function loadData() {
  return import("./data");
}

describe("품기 빌드의 데이터", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_BINJARI_FEED", "1");
    vi.resetModules();
    g.window = globalThis;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete g.window;
    delete g.__BINJARI_FEED__;
  });

  it("기준 시각·기존 예약·의원 이름을 바깥 입력에서 읽는다", async () => {
    g.__BINJARI_FEED__ = feed("2026-09-22T09:00:00+09:00", [{ id: "A000", service: "first-consult", date: "2026-09-22", start: "10:00" }]);
    const { demoSource, demoNowMs } = await loadData();
    const s = demoSource();
    expect(s.data.ok).toBe(true);
    expect(demoNowMs()).toBe(parseInstant("2026-09-22T09:00:00+09:00"));
    expect([s.clinicName, s.sourceLabel]).toEqual(["데모성형외과", "CRM 예약 1건"]);
    if (s.data.ok) expect(s.data.schedule.bookings.map((b) => b.id)).toEqual(["A000"]); // 샘플의원 합성 예약 391건이 아니다
  });

  it("다시 읽어 새 값이 들어오면 새로 만들고, 같은 값이면 다시 만들지 않는다", async () => {
    g.__BINJARI_FEED__ = feed("2026-09-22T09:00:00+09:00");
    const { demoSource } = await loadData();
    const first = demoSource();
    expect(demoSource()).toBe(first);
    g.__BINJARI_FEED__ = feed("2026-09-22T11:30:00+09:00");
    expect(demoSource().nowMs).toBe(parseInstant("2026-09-22T11:30:00+09:00"));
  });

  it("바깥 입력이 없으면 샘플의원 값으로 넘어가지 않고 멈춘다", async () => {
    const { demo } = await loadData();
    const d = demo();
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.errors.join()).toContain("feed.js를 읽지 못했습니다");
  });

  it("늦게 온 입력도 받는다(처음엔 오류였어도)", async () => {
    const { demo } = await loadData();
    expect(demo().ok).toBe(false);
    g.__BINJARI_FEED__ = feed("2026-09-22T09:00:00+09:00");
    expect(demo().ok).toBe(true);
  });

  it("모양이 틀리면 이유와 함께 멈춘다", async () => {
    g.__BINJARI_FEED__ = { ...feed("2026-09-22T09:00:00+09:00"), extra: 1 };
    const { demo } = await loadData();
    const d = demo();
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.errors).toContain("feed.js: feed 모르는 키입니다: extra");
  });
});
