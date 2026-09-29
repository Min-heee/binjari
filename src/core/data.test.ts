import { describe, expect, it } from "vitest";
import bundle from "@/generated/bundle.json";
import { DEMO_NOW, DEMO_NOW_MS, DEMO_RANGE, isDemoNowAllowed } from "@/demo/clock";
import { loadDemo } from "@/demo/data";
import { localDate } from "./calendar";
import { at, engine, repoFile, schedule } from "./__fixtures__/load";
import { overbooked, parseSchedule } from "./schedule";
import { checkSlot, dayLines, findSlots, type SearchInput } from "./slots";

/**
 * 합성 기존 예약(data/bookings.json, PRD F8)을 **앱 엔진으로** 다시 검사한다. 예약은 파이썬 생성기가 따로 짠 점유 검사로 놓았으므로
 * 두 구현이 서로를 한 번 확인한다. 그리고 PRD 7절 심은 경계 사례가 합성 예약을 넣은 채로도 의도대로 판정되는지 본다.
 */

const E = engine();
const S = schedule(E);
const D = localDate;
const BASE_1006 = at("2026-10-06T10:00");

describe("합성 예약 파일", () => {
  it("모양이 맞고, 수량을 넘는 분이 없다", () => {
    expect(S.bookings.length).toBeGreaterThan(300);
    expect(overbooked(E, S)).toEqual([]);
  });
  it("기간: 일반 예약 9/21~10/19, 수술 9/21~11/2", () => {
    const general = S.bookings.filter((b) => !b.service.startsWith("surgery"));
    const surgery = S.bookings.filter((b) => b.service.startsWith("surgery"));
    expect([general.map((b) => b.date).sort()[0], general.map((b) => b.date).sort().at(-1)! <= "2026-10-19"]).toEqual(["2026-09-21", true]);
    expect(surgery.map((b) => b.date).sort().at(-1)).toBe("2026-11-02");
  });
  it("모든 예약이 다른 예약을 둔 채로 규칙을 지킨다(진료일·접수 마감·진료 종료·점심·수술 날 조건·하루 최대·자원)", () => {
    const bad: string[] = [];
    for (const b of S.bookings) {
      const others = { ...S, bookings: S.bookings.filter((x) => x.id !== b.id) };
      const c = checkSlot(E, { service: b.service, nowMs: at("2026-09-01T10:00"), schedule: others }, b.date, b.start);
      if (c.reasons.length > 0) bad.push(`${b.id} ${b.service} ${b.date} ${b.start}: ${c.reasons.join(",")}`);
    }
    expect(bad).toEqual([]);
  });
  it("자원 일정: 9/30 의료진 1명 휴무", () => {
    expect(S.exceptions).toEqual([{ date: "2026-09-30", resource: "doctor", delta: -1, note: "의료진 1명 휴무(합성)" }]);
  });
  it("이름·연락처 칸이 없다(배정은 '의료진 A' 같은 가명만)", () => {
    const raw = JSON.parse(repoFile("data/bookings.json")) as { bookings: Record<string, unknown>[] };
    for (const b of raw.bookings) expect(Object.keys(b).every((k) => ["id", "service", "date", "start", "assigned"].includes(k))).toBe(true);
    expect(S.bookings.flatMap((b) => Object.values(b.assigned ?? {})).every((v) => /^의료진 [A-Z]$/.test(v))).toBe(true);
    expect(repoFile("data/bookings.json")).not.toMatch(/01[016789]-?\d{3,4}-?\d{4}/);
  });
  it("모르는 안건이 섞이면 거부한다", () => {
    const r = parseSchedule({ bookings: [{ id: "x", service: "hair-cut", date: "2026-09-22", start: "10:00" }], exceptions: [] }, E);
    expect(r).toEqual({ ok: false, errors: ["bookings[0].service가 B01에 없는 안건입니다: hair-cut"] });
  });
});

describe("심은 경계 사례(PRD 7절) — 합성 예약을 넣은 채로", () => {
  const c = (service: string, date: string, start: string, nowMs = DEMO_NOW_MS, extra: Partial<SearchInput> = {}) =>
    checkSlot(E, { service, nowMs, schedule: S, ...extra }, D(date), start);

  it.each([
    ["9/22 12:00 첫 상담 가능(점심과 맞닿기만)", "first-consult", "2026-09-22", "12:00", []],
    ["9/22 12:30 첫 상담 불가(점심)", "first-consult", "2026-09-22", "12:30", ["lunch"]],
    ["9/22 12:30 주사 가능", "injection", "2026-09-22", "12:30", []],
    ["9/22 14:00 첫 상담 가능(점심 직후)", "first-consult", "2026-09-22", "14:00", []],
    ["9/22 18:00 첫 상담 가능", "first-consult", "2026-09-22", "18:00", []],
    ["9/22 18:30 주사 가능(접수 마감 포함)", "injection", "2026-09-22", "18:30", []],
    ["10/1 20:00 첫 상담 가능(목 야간)", "first-consult", "2026-10-01", "20:00", []],
    ["10/1 20:30 주사 가능", "injection", "2026-10-01", "20:30", []],
    ["10/1 수술 가능(D+1 10/2 진료)", "surgery-full", "2026-10-01", "10:00", []],
    ["9/28 수술 하루 가능(정리 18:00~18:30)", "surgery-full", "2026-09-28", "10:00", []],
  ])("%s", (_, service, date, start, reasons) => {
    expect(c(service, date, start).reasons).toEqual(reasons);
  });

  it.each([
    ["10/2(D+1 개천절)", "2026-10-02"],
    ["10/8(D+1 한글날)", "2026-10-08"],
    ["10/15(D+1 임시 휴진)", "2026-10-15"],
  ])("수술 불가 %s — 합성 예약 까닭이 섞여도 대표 까닭은 다음 날 휴진", (_, date) => {
    const r = c("surgery-full", date, "10:00");
    expect(r.reasons).toContain("next-day-closed");
    expect(r.primary).toBe("next-day-closed");
  });

  it("9/22 18:30 첫 상담은 진료 종료를 넘긴다(자원 까닭이 섞여도 대표 까닭은 past-close)", () => {
    expect(c("first-consult", "2026-09-22", "18:30").primary).toBe("past-close");
    expect(c("first-consult", "2026-10-01", "20:30").primary).toBe("past-close");
  });

  it.each([
    ["10/10 14:00 첫 상담 가능", "first-consult", "2026-10-10", "14:00", []],
    ["10/10 14:30 주사 가능", "injection", "2026-10-10", "14:30", []],
    ["10/23 수술 가능(D+1 토요일 진료)", "surgery-full", "2026-10-23", "10:00", []],
    ["10/16 임시 휴진", "first-consult", "2026-10-16", "10:00", ["closed"]],
  ])("기준 10/6: %s", (_, service, date, start, reasons) => {
    expect(c(service, date, start, BASE_1006).reasons).toEqual(reasons);
  });

  it("기준 10/6: 10/10 14:30 첫 상담 불가, 10/10 수술은 토요일", () => {
    expect(c("first-consult", "2026-10-10", "14:30", BASE_1006).primary).toBe("past-close");
    expect(c("surgery-full", "2026-10-10", "10:00", BASE_1006).primary).toBe("no-surgery-day");
  });

  it("9/30 첫 상담은 의료진 1명 휴무 + 합성 수술로 칸 0 → 예약 꽉 참", () => {
    const r = findSlots(E, { service: "first-consult", nowMs: DEMO_NOW_MS, schedule: S });
    if (!r.ok) throw new Error();
    const d = r.days.find((x) => x.date === "2026-09-30")!;
    expect(d.slots).toEqual([]);
    expect(d.kind).toBe("full");
    expect(dayLines(r.days).some((l) => l.text.startsWith("9/29(화)~9/30(수) 예약 꽉 참") || l.text === "9/30(수) 예약 꽉 참")).toBe(true);
  });

  it.each([
    ["2026-09-21T10:00", "2026-09-21", "11:00"],
    ["2026-09-21T11:00", "2026-09-21", "12:00"],
    ["2026-09-23T12:50", "2026-09-23", "14:00"],
    ["2026-09-28T11:00", "2026-09-28", "12:00"],
    ["2026-10-01T20:10", "2026-10-02", "10:00"],
  ])("주사 첫 칸(첫 예약 가능 시각 올림): 기준 %s → %s %s", (now, date, start) => {
    const r = findSlots(E, { service: "injection", nowMs: at(now), schedule: S });
    if (!r.ok) throw new Error();
    expect([r.slots[0].date, r.slots[0].start]).toEqual([date, start]);
  });
});

describe("시연 기준 시각", () => {
  it("clock.ts와 번들이 같은 기준 시각을 쓴다(한창구와 같은 9/21 10:00)", () => {
    expect(DEMO_NOW).toBe("2026-09-21T10:00:00+09:00");
    expect(bundle.asOf).toBe(DEMO_NOW);
  });
  it("바꿔 볼 수 있는 범위는 9/21 10:00~10/6 19:00", () => {
    expect(isDemoNowAllowed(DEMO_RANGE.from)).toBe(true);
    expect(isDemoNowAllowed(at("2026-10-06T19:00"))).toBe(true);
    expect(isDemoNowAllowed(at("2026-10-06T19:10"))).toBe(false);
    expect(isDemoNowAllowed(at("2026-09-21T09:50"))).toBe(false);
  });
  it("번들로 만든 엔진·예약이 저장소 파일과 같다", () => {
    const d = loadDemo();
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.schedule).toEqual(S);
  });
});
