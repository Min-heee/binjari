import { describe, expect, it } from "vitest";
import { localDate } from "@/core/calendar";
import type { Engine } from "@/core/engine";
import { liveHolds, makeHold } from "@/core/holds";
import type { Schedule } from "@/core/schedule";
import { DEMO_NOW, DEMO_NOW_MS, DEMO_RANGE } from "./clock";
import { mustDemo } from "./data";
import { demoHolds, sweepViolations } from "./evaluate";
import { holdAlive, RULES, ViolationChecker } from "./violations";

/**
 * 따로 짠 규칙 위반 검사기가 **실제로 위반을 잡는지** 먼저 본다(규칙마다 일부러 어긴 칸). 잡지 못하는 검사기로 "위반 0"을 내면 의미가 없다.
 * 그다음 앱이 낸 칸 전체를 성긴 간격(2시간)으로 훑어 위반 0을 확인한다. 평가 화면은 10분 간격으로 같은 함수를 부른다.
 */

const { engine, schedule } = mustDemo();
const D = localDate;
const check = (e: Engine, s: Schedule, service: string, date: string, start: string, holds = [] as ReturnType<typeof makeHold>[], now = DEMO_NOW_MS) =>
  new ViolationChecker(e, s, holds).at(now).check({ service, date, start });

describe("검사기가 일부러 어긴 칸을 잡는다", () => {
  it("멀쩡한 칸은 위반 없음(9/22 12:00 첫 상담 — 점심과 맞닿기만 함)", () => {
    expect(check(engine, schedule, "first-consult", "2026-09-22", "12:00")).toEqual([]);
  });
  it("점심 겹침 · 접수 마감 뒤 · 진료 종료 넘김", () => {
    expect(check(engine, schedule, "first-consult", "2026-09-22", "12:30")).toContain("lunch");
    expect(check(engine, schedule, "injection", "2026-09-22", "18:40")).toContain("last-entry");
    expect(check(engine, schedule, "first-consult", "2026-09-22", "18:30")).toContain("past-close");
    expect(check(engine, schedule, "injection", "2026-09-22", "18:30")).toEqual([]);
  });
  it("휴진일(추석)과 공휴일 확인 기간 밖", () => {
    expect(check(engine, schedule, "injection", "2026-09-24", "11:00")).toEqual(["closed"]);
    expect(check(engine, schedule, "injection", "2028-01-04", "11:00")).toEqual(["closed"]);
  });
  it("토요일 수술 · 다음 날 휴진 수술 · 첫 가능일 전 수술", () => {
    expect(check(engine, schedule, "surgery-full", "2026-10-10", "10:00")).toEqual(expect.arrayContaining(["saturday-surgery", "next-day-closed"]));
    expect(check(engine, schedule, "surgery-full", "2026-10-02", "10:00")).toContain("next-day-closed");
    expect(check(engine, schedule, "surgery-full", "2026-09-23", "10:00")).toContain("earliest");
  });
  it("D+7 창에 진료일 없는 수술(D+6~D+9를 임시 휴진으로 막은 엔진)", () => {
    const closed = ["2026-10-19", "2026-10-20", "2026-10-21"].map((d) => ({ date: D(d), reason: "시험" }));
    const e: Engine = { ...engine, hours: { ...engine.hours, extraClosed: [...engine.hours.extraClosed, ...closed] } };
    expect(check(e, schedule, "surgery-full", "2026-10-12", "10:00")).toContain("no-d7");
    expect(check(engine, schedule, "surgery-full", "2026-10-12", "10:00")).not.toContain("no-d7");
  });
  it("하루 최대 · 사람·방 수 초과", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `T${i}`, service: "first-consult", date: D("2026-10-06"), start: "10:00" }));
    expect(check(engine, { ...schedule, bookings: [...schedule.bookings, ...six] }, "first-consult", "2026-10-06", "16:00")).toContain("daily-max");
    const busy = { ...schedule, bookings: [...schedule.bookings, { id: "T9", service: "injection", date: D("2026-09-22"), start: "15:00" }] };
    expect(check(engine, busy, "injection", "2026-09-22", "15:00")).toContain("resource");
  });
  it("살아 있는 가예약과 같은 칸 · 첫 예약 가능 시각 전", () => {
    const h = makeHold({ service: "injection", date: D("2026-09-21"), start: "11:00", createdAt: DEMO_NOW });
    expect(check(engine, schedule, "injection", "2026-09-21", "11:00", [h])).toEqual(expect.arrayContaining(["held", "resource"]));
    expect(check(engine, schedule, "first-consult", "2026-09-21", "10:30")).toContain("earliest");
  });
});

describe("검사기의 가예약 수명 = 엔진의 가예약 수명(따로 짠 두 구현)", () => {
  it("평가용 가예약 셋을 기준 시각 30분마다 비교", () => {
    const holds = demoHolds(engine, schedule);
    expect(holds).toHaveLength(3);
    for (let t = DEMO_RANGE.from - 3_600_000; t <= DEMO_RANGE.from + 3 * 86_400_000; t += 30 * 60_000) {
      const mine = holds.filter((h) => holdAlive(engine, h, t)).map((h) => h.id);
      const core = liveHolds(engine, holds, t).map((h) => h.id);
      expect(mine, String(t)).toEqual(core);
    }
  });
});

describe("앱이 낸 칸 전체(2시간 간격)", () => {
  const r = sweepViolations(engine, schedule, demoHolds(engine, schedule), { stepMinutes: 120 });
  it("규칙마다 위반 0, 분모는 0이 아님", () => {
    expect(r.rules.map((x) => x.key)).toEqual(RULES.map((x) => x.key));
    for (const x of r.rules) {
      expect(x.violations, x.label).toBe(0);
      expect(x.checked, x.label).toBeGreaterThan(0);
    }
    expect(r.examples).toEqual([]);
    expect(r.times).toBeGreaterThan(150);
  });
});
