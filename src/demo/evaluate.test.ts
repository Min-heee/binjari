import { describe, expect, it } from "vitest";
import { mustDemo } from "./data";
import { BOUNDARIES, buildReport, runBoundaries, runDayCases, runDeterminism, demoHolds, EVAL_BASES, EVAL_SERVICES } from "./evaluate";

/** 평가 화면이 싣는 값(PRD 7절). 여기서 목표에 못 미치면 화면에도 그대로 실린다 — 시험은 지금 값이 목표에 맞는지 본다. */

const { engine, schedule } = mustDemo();

describe("심은 경계 사례(PRD 7절 표)", () => {
  it("PRD 표의 칸 사례가 모두 있다(10/16은 안건 6종 모두)", () => {
    expect(BOUNDARIES.filter((b) => b.date === "2026-10-16").map((b) => b.service)).toEqual([...EVAL_SERVICES]);
    expect(BOUNDARIES.length).toBe(27);
  });
  it("모두 의도대로 판정된다(합성 예약을 넣은 채로)", () => {
    const failed = runBoundaries(engine, schedule).filter((b) => !b.pass);
    expect(failed.map((b) => `${b.date} ${b.start} ${b.service}: ${b.reasons.join(",")}`)).toEqual([]);
  });
  it("9/30 예약 꽉 참과 첫 예약 가능 시각 올림 4건", () => {
    const cases = runDayCases(engine, schedule);
    expect(cases).toHaveLength(5);
    expect(cases.filter((c) => !c.pass)).toEqual([]);
  });
});

describe("결정성", () => {
  it("기준 시각 5 × 안건 6 × 변형 3 = 90쌍에서 달라진 것 0", () => {
    const r = runDeterminism(engine, schedule, demoHolds(engine, schedule));
    expect(EVAL_BASES).toHaveLength(5);
    expect(r).toEqual({ total: 90, changed: 0, details: [] });
  });
});

describe("평가 묶음", () => {
  it("성긴 간격(4시간)으로도 모든 칸이 채워진다", () => {
    const r = buildReport(engine, schedule, 240);
    expect(r.sweep.stepMinutes).toBe(240);
    expect(r.sweep.rules.every((x) => x.violations === 0)).toBe(true);
    expect(r.holds).toHaveLength(3);
    expect(r.presses.length).toBe(11);
    expect(r.firstSlots.find((f) => f.service === "surgery-full")).toMatchObject({ count: 4, first: ["9/28(월) 10:00", "10/1(목) 10:00", "10/12(월) 10:00", "10/14(수) 10:00"] });
    expect(r.firstSlots.find((f) => f.service === "first-consult")?.count).toBe(38);
  });
});
