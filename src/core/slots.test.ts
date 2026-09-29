import { describe, expect, it } from "vitest";
import { addDays, localDate } from "./calendar";
import { at, EMPTY, engine, engineWithB01, NOW, TODAY } from "./__fixtures__/load";
import { makeHold } from "./holds";
import type { Booking, Schedule } from "./schedule";
import { usageOf } from "./schedule";
import { applyFilter, checkSlot, dayLines, findSlots, firstBookable, suggestSlots, type SearchInput, type SearchResult } from "./slots";

/**
 * 빈 시간 엔진의 경계(PRD F3 ①~⑨, 5.2, 7절 심은 경계 사례). 여기서는 **빈 예약표**로 규칙만 본다.
 * 합성 예약을 넣은 같은 사례는 data.test.ts가 본다.
 */

const E = engine();
const D = (s: string) => localDate(s);

function chk(service: string, date: string, start: string, opts: Partial<SearchInput> = {}) {
  return checkSlot(E, { service, nowMs: NOW, schedule: EMPTY, ...opts }, D(date), start);
}

function ok(r: SearchResult): Extract<SearchResult, { ok: true }> {
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r;
}

let n = 0;
function bk(service: string, date: string, start: string): Booking {
  n += 1;
  return { id: `T${n}`, service, date: D(date), start };
}

function sched(bookings: Booking[], exceptions: Schedule["exceptions"] = []): Schedule {
  return { bookings, exceptions };
}

describe("점심(⑥) — 반개구간", () => {
  it("12:00 첫 상담은 점심과 맞닿기만 해서 된다(9/22)", () => expect(chk("first-consult", "2026-09-22", "12:00").reasons).toEqual([]));
  it("12:30 첫 상담은 점심과 겹친다", () => expect(chk("first-consult", "2026-09-22", "12:30").reasons).toEqual(["lunch"]));
  it("12:30 주사(30분)는 13:00에 끝나 된다", () => expect(chk("injection", "2026-09-22", "12:30").reasons).toEqual([]));
  it("13:00·13:30 칸은 점심 안이라 안 된다", () => {
    expect(chk("injection", "2026-09-22", "13:00").reasons).toEqual(["lunch"]);
    expect(chk("injection", "2026-09-22", "13:30").reasons).toEqual(["lunch"]);
  });
  it("14:00 첫 상담은 점심 직후라 된다", () => expect(chk("first-consult", "2026-09-22", "14:00").reasons).toEqual([]));
  it("토요일은 점심이 없다(10/10 12:30 첫 상담, 기준 10/6)", () => {
    expect(chk("first-consult", "2026-10-10", "12:30", { nowMs: at("2026-10-06T10:00") }).reasons).toEqual([]);
  });
  it("수술만 점심을 가로지른다 — 같은 시각 60분 안건은 점심 예외가 새지 않는다", () => {
    expect(chk("surgery-full", "2026-09-28", "10:00").reasons).toEqual([]);
    expect(chk("scalp-care", "2026-09-28", "12:30").reasons).toEqual(["lunch"]);
    expect(chk("revisit-consult", "2026-09-28", "13:00").reasons).toEqual(["lunch"]);
  });
});

describe("접수 마감(④, 포함)과 진료 종료(⑤)", () => {
  it("평일 18:00 첫 상담은 19:00에 끝나 된다", () => expect(chk("first-consult", "2026-09-22", "18:00").reasons).toEqual([]));
  it("평일 18:30 첫 상담은 진료 종료를 넘긴다(접수 마감은 포함이라 까닭이 아님)", () => {
    expect(chk("first-consult", "2026-09-22", "18:30").reasons).toEqual(["past-close"]);
  });
  it("평일 18:30 주사는 접수 마감 포함이라 된다", () => expect(chk("injection", "2026-09-22", "18:30").reasons).toEqual([]));
  it("평일 18:31이 있다면 접수 마감 뒤다(분 단위 검사)", () => {
    const e = engineWithB01((j) => ((j.services as Record<string, { starts: unknown }>).injection.starts = ["18:31"]));
    expect(checkSlot(e, { service: "injection", nowMs: NOW, schedule: EMPTY }, D("2026-09-22"), "18:31").reasons).toEqual(["after-last-entry", "past-close"]);
  });
  it("목요일 20:00 첫 상담·20:30 주사는 되고, 20:30 첫 상담은 안 된다(10/1)", () => {
    expect(chk("first-consult", "2026-10-01", "20:00").reasons).toEqual([]);
    expect(chk("first-consult", "2026-10-01", "20:30").reasons).toEqual(["past-close"]);
    expect(chk("injection", "2026-10-01", "20:30").reasons).toEqual([]);
  });
  it("토요일 14:00 첫 상담·14:30 주사는 되고, 14:30 첫 상담은 안 된다(10/10, 기준 10/6)", () => {
    const o = { nowMs: at("2026-10-06T10:00") };
    expect(chk("first-consult", "2026-10-10", "14:00", o).reasons).toEqual([]);
    expect(chk("first-consult", "2026-10-10", "14:30", o).reasons).toEqual(["past-close"]);
    expect(chk("injection", "2026-10-10", "14:30", o).reasons).toEqual([]);
  });
  it("수술 하루 9/28 10:00 — 수술실 정리 18:00~18:30이 진료 종료 안", () => {
    expect(chk("surgery-full", "2026-09-28", "10:00").reasons).toEqual([]);
    const room = usageOf(E.rules, E.rules.services["surgery-full"], 600).filter((u) => u.resource === "surgeryRoom");
    expect(room).toEqual([
      { resource: "surgeryRoom", from: 600, to: 1080, count: 1 },
      { resource: "surgeryRoom", from: 1080, to: 1110, count: 1 },
    ]);
  });
  it("준비 시간도 진료 종료 안에 들어가야 한다(수술 510분은 되고 520분은 정리 시간 때문에 안 된다)", () => {
    const set = (m: number) =>
      engineWithB01((j) => {
        const svc = (j.services as Record<string, { minutes: number; phases: { to: number }[] }>)["surgery-full"];
        svc.minutes = m;
        svc.phases[0].to = m;
      });
    const c = (e: ReturnType<typeof engine>) => checkSlot(e, { service: "surgery-full", nowMs: NOW, schedule: EMPTY }, D("2026-09-28"), "10:00").reasons;
    expect(c(set(510))).toEqual([]);
    expect(c(set(520))).toEqual(["past-close"]);
  });
});

describe("첫 예약 가능 시각(③) — 기준 시각 + 60분을 30분 격자로 올림", () => {
  it.each([
    ["2026-09-21T10:00", "2026-09-21", "11:00"],
    ["2026-09-21T10:10", "2026-09-21", "11:30"],
    ["2026-09-21T11:00", "2026-09-21", "12:00"],
    ["2026-09-23T12:50", "2026-09-23", "14:00"],
    ["2026-09-21T12:10", "2026-09-21", "14:00"],
    ["2026-09-28T11:00", "2026-09-28", "12:00"],
    ["2026-10-01T20:10", "2026-10-02", "10:00"],
    ["2026-09-22T17:30", "2026-09-22", "18:30"],
    ["2026-09-22T17:40", "2026-09-23", "10:00"],
    ["2026-09-23T18:00", "2026-09-28", "10:00"],
  ])("기준 %s → %s %s", (now, date, time) => {
    expect(firstBookable(E, at(now))).toEqual({ date, time });
  });

  it.each([
    ["2026-09-21T10:00", "2026-09-21", "11:00"],
    ["2026-09-21T11:00", "2026-09-21", "12:00"],
    ["2026-09-23T12:50", "2026-09-23", "14:00"],
    ["2026-10-01T20:10", "2026-10-02", "10:00"],
  ])("빈 예약표의 주사 첫 칸: 기준 %s → %s %s", (now, date, start) => {
    const r = ok(findSlots(E, { service: "injection", nowMs: at(now), schedule: EMPTY }));
    expect([r.slots[0].date, r.slots[0].start]).toEqual([date, start]);
  });

  it("기준 시각 + 60분 전 칸은 before-earliest", () => {
    expect(chk("injection", "2026-09-21", "10:30").reasons).toEqual(["before-earliest"]);
    expect(chk("injection", "2026-09-21", "11:00").reasons).toEqual([]);
  });

  it("오늘 칸이 없으면 까닭을 한 줄로: 진료 종료 / 첫 예약 가능 시각 이후 빈 시간 없음", () => {
    const late = ok(findSlots(E, { service: "injection", nowMs: at("2026-10-01T20:10"), schedule: EMPTY }));
    expect(late.days[0]).toMatchObject({ date: "2026-10-01", kind: "today-none", message: "오늘은 진료 종료" });
    // 오늘 남은 칸(11:00~)을 모두 막으면 "첫 예약 가능 시각 이후 빈 시간 없음".
    const full: Booking[] = [];
    for (const t of ["11:00", "11:30", "12:00", "12:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"]) full.push(bk("injection", "2026-09-21", t));
    const r = ok(findSlots(E, { service: "injection", nowMs: NOW, schedule: sched(full) }));
    expect(r.days[0]).toMatchObject({ kind: "today-none", message: "첫 예약 가능 시각 이후 빈 시간 없음" });
  });

  it("수술은 기준일 + 7일부터(9/28은 되고 9/25 전 날들은 too-soon)", () => {
    expect(chk("surgery-full", "2026-09-22", "10:00").reasons).toEqual(["before-earliest"]);
    const r = ok(findSlots(E, { service: "surgery-full", nowMs: NOW, schedule: EMPTY }));
    expect(r.slots[0]).toMatchObject({ date: "2026-09-28", start: "10:00", nextDay: "2026-09-29" });
    expect(dayLines(r.days)[0].text).toBe("9/21(월)~9/22(화) 수술은 기준일 + 7일부터[가정]");
  });
});

describe("휴진·공휴일(①)", () => {
  it("추석 연휴와 일요일은 한 줄로 묶고 사유를 나눠 적는다", () => {
    const r = ok(findSlots(E, { service: "first-consult", nowMs: NOW, schedule: EMPTY }));
    const lines = dayLines(r.days).filter((l) => l.kind === "closed").map((l) => l.text);
    expect(lines).toEqual(["9/24(목)~9/27(일) 추석 연휴·일요일 — 휴진", "10/3(토)~10/4(일) 개천절·일요일 — 휴진"]);
  });
  it("10/16 임시 휴진은 모든 안건이 안 된다(기준 10/6)", () => {
    for (const s of ["first-consult", "revisit-consult", "injection", "scalp-care", "surgery-full", "surgery-half"]) {
      expect(chk(s, "2026-10-16", "10:00", { nowMs: at("2026-10-06T10:00") }).reasons, s).toEqual(["closed"]);
    }
    const r = ok(findSlots(E, { service: "injection", nowMs: at("2026-10-06T10:00"), schedule: EMPTY }));
    expect(dayLines(r.days).find((l) => l.from === "2026-10-16")?.text).toBe("10/16(금) 임시 휴진(내부 교육) — 휴진");
  });
  it("공휴일 확인 범위(2027-12-31) 밖 날짜는 칸을 내지 않는다", () => {
    const r = ok(findSlots(E, { service: "injection", nowMs: at("2027-12-28T10:00"), schedule: EMPTY }));
    const after = r.days.filter((d) => d.date > "2027-12-31");
    expect(after.length).toBeGreaterThan(0);
    for (const d of after) expect(d.kind === "holiday-unknown" || d.kind === "closed", d.date).toBe(true);
    expect(after.every((d) => d.slots.length === 0)).toBe(true);
    const texts = dayLines(r.days).map((l) => l.text);
    expect(texts).toContain("1/1(토) 공휴일 미확인 — 계산하지 않음");
    expect(texts).toContain("1/3(월)~1/8(토) 공휴일 미확인 — 계산하지 않음");
    expect(r.days.find((d) => d.date === "2027-12-31")?.kind).toBe("slots");
    expect(chk("injection", "2028-01-03", "10:00", { nowMs: at("2027-12-28T10:00") }).reasons).toEqual(["holiday-unknown"]);
  });
  it("수술: D+1이나 D+6~D+9가 확인 범위 밖이면 계산하지 않는다(2027-12-30)", () => {
    expect(chk("surgery-full", "2027-12-30", "10:00", { nowMs: at("2027-12-20T10:00") }).reasons).toEqual(["holiday-unknown"]);
  });
});

describe("수술 날 조건(②)", () => {
  const o10 = { nowMs: at("2026-10-06T10:00") };
  it("10/10 평범한 토요일은 수술 없는 날", () => {
    // 기준 10/6에서 10/10은 기준일 + 7일 전이기도 하다. 까닭은 모두 남기고 대표는 '수술 없는 날'.
    expect(chk("surgery-full", "2026-10-10", "10:00", o10).reasons).toEqual(["no-surgery-day", "next-day-closed", "before-earliest", "past-close"]);
    expect(chk("surgery-full", "2026-10-17", "10:00", o10).reasons).toEqual(["no-surgery-day", "next-day-closed", "past-close"]);
    expect(chk("surgery-full", "2026-10-10", "10:00", o10).primary).toBe("no-surgery-day");
  });
  it("10/2(금)은 다음 날 10/3 개천절이라 안 된다", () => {
    expect(chk("surgery-full", "2026-10-02", "10:00").reasons).toEqual(["next-day-closed"]);
    const r = ok(findSlots(E, { service: "surgery-full", nowMs: NOW, schedule: EMPTY }));
    expect(dayLines(r.days).find((l) => l.from === "2026-10-02")?.text).toBe("10/2(금) 수술 불가 — 다음 날 10/3(토) 개천절 휴진");
    expect(dayLines(r.days).find((l) => l.from === "2026-10-10")?.text).toBe("10/10(토) 수술 없는 날(토요일, V02)");
  });
  it("10/8(목)·10/15(목)은 다음 날 한글날·임시 휴진이라 안 된다", () => {
    expect(chk("surgery-full", "2026-10-08", "10:00").reasons).toEqual(["next-day-closed"]);
    expect(chk("surgery-full", "2026-10-15", "10:00").reasons).toEqual(["next-day-closed"]);
  });
  it("10/1(목)은 다음 날 10/2 진료라 된다", () => expect(chk("surgery-full", "2026-10-01", "10:00").reasons).toEqual([]));
  it("10/23(금)은 다음 날이 토요일 진료라 된다(기준 10/6)", () => expect(chk("surgery-full", "2026-10-23", "10:00", o10).reasons).toEqual([]));
  it("9/18(금)은 다음 날 진료지만 D+6~D+9(9/24~27)이 모두 휴진이라 안 된다", () => {
    expect(chk("surgery-full", "2026-09-18", "10:00", { nowMs: at("2026-09-08T10:00") }).reasons).toEqual(["no-d7-open-day"]);
  });
  it("반나절 수술은 10:00·14:30 두 시작 후보, 하루 수술은 10:00 하나", () => {
    const half = ok(findSlots(E, { service: "surgery-half", nowMs: NOW, schedule: EMPTY }));
    expect(half.slots.filter((s) => s.date === "2026-09-28").map((s) => s.start)).toEqual(["10:00", "14:30"]);
    const full = ok(findSlots(E, { service: "surgery-full", nowMs: NOW, schedule: EMPTY }));
    expect(full.slots.filter((s) => s.date === "2026-09-28").map((s) => s.start)).toEqual(["10:00"]);
  });
  it("오전 반나절 수술 뒤 수술실 정리 14:00~14:30이 끝나면 14:30 반나절이 맞닿아 된다", () => {
    const s = sched([bk("surgery-half", "2026-09-28", "10:00")]);
    expect(chk("surgery-half", "2026-09-28", "14:30", { schedule: s }).reasons).toEqual([]);
    expect(chk("surgery-full", "2026-09-28", "10:00", { schedule: s }).reasons).toEqual(["resource"]);
  });
  it("정리 시간을 빼면 달라지는 경우: 수술 뒤 30분 안에 시작하는 수술은 수술실이 없다", () => {
    const e = engineWithB01((j) => ((j.services as Record<string, { starts: string[] }>)["surgery-half"].starts = ["10:00", "14:00"]));
    const s = sched([bk("surgery-half", "2026-09-28", "10:00")]);
    const c = checkSlot(e, { service: "surgery-half", nowMs: NOW, schedule: s }, D("2026-09-28"), "14:00");
    expect(c.reasons).toEqual(["resource"]);
    expect(c.short).toEqual(["surgeryRoom"]);
  });
  it("수술 14일 안 칸에는 '취소·변경은 원무팀 개별 안내', 칩마다 다음 날 내원", () => {
    const r = ok(findSlots(E, { service: "surgery-full", nowMs: NOW, schedule: EMPTY }));
    const s928 = r.slots.find((s) => s.date === "2026-09-28")!;
    expect(s928.tags).toEqual(["다음 날 내원 9/29(화)", "14일 안 수술 — 취소·변경은 원무팀 개별 안내(V04)"]);
    const s1005 = r.slots.find((s) => s.date >= "2026-10-05")!;
    expect(s1005.date).toBe("2026-10-06");
    expect(s1005.tags).toEqual(["다음 날 내원 10/7(수)"]);
  });
});

describe("자원(⑧) — 단계·목요일 야간·자원 일정", () => {
  it("첫 상담은 단계별로 사람을 쓴다: 의료진은 20~40분만", () => {
    // 의료진 2명이 10:40~11:10에 재진 상담 중. 10:00 첫 상담의 의료진 단계(10:20~10:40)는 맞닿기만 해서 되고,
    // 10:30 첫 상담(의료진 10:50~11:10)은 안 된다. 60분 통째로 의료진을 묶는 모델이면 10:00도 막힌다.
    // 재진은 상담실도 쓰므로, 의료진 단계만 보려고 상담실을 4로 늘린 규칙에서 본다.
    const s = sched([bk("revisit-consult", "2026-09-28", "10:40"), bk("revisit-consult", "2026-09-28", "10:40")]);
    const e = engineWithB01((j) => {
      (j.capacity as { base: Record<string, number> }).base.consultRoom = 4;
    });
    const c = (t: string) => checkSlot(e, { service: "first-consult", nowMs: NOW, schedule: s }, D("2026-09-28"), t);
    expect(c("10:00").reasons).toEqual([]);
    expect(c("10:30").reasons).toEqual(["resource"]);
    expect(c("10:30").short).toEqual(["doctor"]);
  });
  it("구간은 반개구간: 앞 예약이 끝나는 분에 같은 자원으로 시작할 수 있다", () => {
    const s = sched([bk("scalp-care", "2026-09-28", "10:00")]); // 관리실 1을 10:00~11:00
    expect(chk("scalp-care", "2026-09-28", "10:30", { schedule: s }).reasons).toEqual(["resource"]);
    expect(chk("scalp-care", "2026-09-28", "11:00", { schedule: s }).reasons).toEqual([]);
  });
  it("목요일 19:00 뒤는 의료진 1명: 재진 한 건이 있으면 같은 시각 재진은 안 되고, 낮에는 된다", () => {
    const s = sched([bk("revisit-consult", "2026-10-01", "19:00"), bk("revisit-consult", "2026-10-01", "17:00")]);
    expect(chk("revisit-consult", "2026-10-01", "19:00", { schedule: s }).reasons).toEqual(["resource"]);
    expect(chk("revisit-consult", "2026-10-01", "17:00", { schedule: s }).reasons).toEqual([]);
  });
  it("목요일 18:30 첫 상담은 19:00을 넘는 단계에서 야간 수량을 본다", () => {
    // 19:00 첫 상담은 간호 19:00~19:20, 의료진 19:20~19:40, 코디 19:40~20:00. 18:30 상담의 의료진(18:50~19:10)·코디(19:10~19:30)와
    // 겹치지 않아 야간 1명씩으로도 된다.
    expect(chk("first-consult", "2026-10-01", "18:30", { schedule: sched([bk("first-consult", "2026-10-01", "19:00")]) }).reasons).toEqual([]);
    // 19:00 재진은 야간 의료진 1명을 19:00~19:30 쓰므로 18:30 상담의 의료진 단계가 19:00~19:10에서 모자란다(낮이면 2명이라 된다).
    const s2 = sched([bk("revisit-consult", "2026-10-01", "19:00")]);
    expect(chk("first-consult", "2026-10-01", "18:30", { schedule: s2 }).reasons).toEqual(["resource"]);
    expect(chk("first-consult", "2026-10-01", "18:30", { schedule: s2 }).short).toEqual(["doctor"]);
    expect(chk("first-consult", "2026-09-28", "18:00", { schedule: sched([bk("revisit-consult", "2026-09-28", "18:30")]) }).reasons).toEqual([]);
  });
  it("자원 일정: 의료진 1명 휴무날 하루 수술이 있으면 의료진 단계가 18:00 전에는 들어가지 않는다", () => {
    const s = sched([bk("surgery-full", "2026-09-30", "10:00")], [{ date: D("2026-09-30"), resource: "doctor", delta: -1, note: "휴무" }]);
    expect(chk("first-consult", "2026-09-30", "17:30", { schedule: s }).reasons).toEqual(["resource"]);
    expect(chk("first-consult", "2026-09-30", "18:00", { schedule: s }).reasons).toEqual([]);
    // 휴무가 없으면 17:30도 된다.
    expect(chk("first-consult", "2026-09-30", "17:30", { schedule: sched(s.bookings) }).reasons).toEqual([]);
  });
  it("수술은 간호 2명을 묶는다: 수술 날 간호 한 명이 더 쓰이면 두피 관리가 안 된다", () => {
    const s = sched([bk("surgery-full", "2026-09-28", "10:00"), bk("injection", "2026-09-28", "11:00")]);
    expect(chk("scalp-care", "2026-09-28", "11:00", { schedule: s }).reasons).toEqual(["resource"]);
    expect(chk("scalp-care", "2026-09-28", "11:30", { schedule: s }).reasons).toEqual([]);
  });
  it("이름 있는 배정(assigned)은 무시한다", () => {
    const b = { ...bk("scalp-care", "2026-09-28", "10:00"), assigned: { nurse: "간호 A" } };
    expect(chk("scalp-care", "2026-09-28", "10:00", { schedule: sched([b]) }).reasons).toEqual(["resource"]);
  });
});

describe("하루 최대(⑦) — 첫 상담 6건, 재진은 세지 않음", () => {
  const five = ["10:00", "11:00", "14:00", "15:00", "16:00"].map((t) => bk("first-consult", "2026-09-28", t));
  it("기존 첫 상담 5건이면 6번째를 낸다", () => expect(chk("first-consult", "2026-09-28", "17:00", { schedule: sched(five) }).reasons).toEqual([]));
  it("6건이면 daily-max", () => {
    const six = [...five, bk("first-consult", "2026-09-28", "17:00")];
    expect(chk("first-consult", "2026-09-28", "18:00", { schedule: sched(six) }).reasons).toEqual(["daily-max"]);
  });
  it("재진 상담 6건은 첫 상담 하루 최대에 들어가지 않는다", () => {
    const rev = ["10:00", "10:30", "11:00", "14:00", "14:30", "15:00"].map((t) => bk("revisit-consult", "2026-09-28", t));
    expect(chk("first-consult", "2026-09-28", "17:00", { schedule: sched(rev) }).reasons).toEqual([]);
  });
  it("재진 상담에는 하루 최대가 없다", () => {
    const six = [...five, bk("first-consult", "2026-09-28", "17:00")];
    expect(chk("revisit-consult", "2026-09-28", "18:00", { schedule: sched(six) }).reasons).toEqual([]);
  });
  it("가예약도 하루 최대에 센다", () => {
    const h = makeHold({ service: "first-consult", date: D("2026-09-28"), start: "17:00", createdAt: "2026-09-21T10:00:00+09:00" });
    expect(chk("first-consult", "2026-09-28", "18:00", { schedule: sched(five), holds: [h] }).reasons).toEqual(["daily-max"]);
  });
});

describe("떨어진 까닭 — 집합과 대표 까닭", () => {
  it("여러 까닭을 모두 남기고, 대표는 B01 순서의 첫 까닭", () => {
    const c = chk("first-consult", "2026-09-21", "10:30", { schedule: sched([bk("revisit-consult", "2026-09-21", "10:30"), bk("revisit-consult", "2026-09-21", "10:30")]) });
    expect(c.reasons).toEqual(["before-earliest", "resource"]);
    expect(c.primary).toBe("before-earliest");
  });
  it("30분 이상 안건의 접수 마감 뒤는 진료 종료 넘김도 함께 남는다", () => {
    const c = chk("first-consult", "2026-09-22", "18:30");
    expect(c.reasons).toEqual(["past-close"]);
    const d = chk("revisit-consult", "2026-09-22", "18:30");
    expect(d.reasons).toEqual([]);
  });
  it("가예약 때문에 모자라면 held, 기존 예약만으로도 모자라면 resource", () => {
    const h = makeHold({ service: "scalp-care", date: D("2026-09-28"), start: "10:00", createdAt: "2026-09-21T10:00:00+09:00" });
    expect(chk("scalp-care", "2026-09-28", "10:00", { holds: [h] }).reasons).toEqual(["held"]);
    expect(chk("scalp-care", "2026-09-28", "10:00", { holds: [h], schedule: sched([bk("scalp-care", "2026-09-28", "10:00")]) }).reasons).toEqual(["resource"]);
  });
});

describe("주사 회차 옮기기(⑨) — 예정일 앞뒤 3일", () => {
  it("예정일 10/1이면 9/28~10/4 창 안의 칸만 낸다", () => {
    const r = ok(findSlots(E, { service: "injection", nowMs: NOW, schedule: EMPTY, moveDue: D("2026-10-01") }));
    expect(r.range).toEqual({ from: "2026-09-28", to: "2026-10-04", days: 7 });
    expect([...new Set(r.slots.map((s) => s.date))]).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(r.slots[0].injectionClosedHits).toBeUndefined();
  });
  it("창이 기준일 전에 걸리면 오늘부터", () => {
    const r = ok(findSlots(E, { service: "injection", nowMs: NOW, schedule: EMPTY, moveDue: D("2026-09-22") }));
    expect(r.range.from).toBe("2026-09-21");
    expect(r.range.to).toBe("2026-09-25");
  });
  it("창 밖 날짜는 outside-window", () => {
    expect(chk("injection", "2026-10-05", "10:00", { moveDue: D("2026-10-01") }).reasons).toEqual(["closed"]);
    expect(chk("injection", "2026-10-06", "10:00", { moveDue: D("2026-10-01") }).reasons).toEqual(["outside-window"]);
  });
  it("창 안에 빈 시간이 없으면 V08 안내를 붙인다", () => {
    // 예정일 9/25: 창 9/22~9/28 중 9/24~27 휴진, 9/22·23·28은 칸이 있다.
    const r = ok(findSlots(E, { service: "injection", nowMs: NOW, schedule: EMPTY, moveDue: D("2026-09-25") }));
    expect(r.windowNote).toBeUndefined();
    // 기준 9/23 18:30이면 오늘 칸이 끝나 9/28만 남고, 예정일 9/24(창 9/21~9/27)이면 하나도 없다.
    const late = ok(findSlots(E, { service: "injection", nowMs: at("2026-09-23T18:30"), schedule: EMPTY, moveDue: D("2026-09-25") }));
    expect(late.slots.map((s) => s.date)).toEqual(Array(late.slots.length).fill("2026-09-28"));
    const none = ok(findSlots(E, { service: "injection", nowMs: at("2026-09-23T18:30"), schedule: EMPTY, moveDue: D("2026-09-24") }));
    expect(none.slots).toEqual([]);
    expect(none.windowNote).toBe("4~14일 늦어지면 간호팀 확인, 14일 넘으면 의료진 진료 뒤 다시 시작(V08)");
  });
  it("주사 말고는 옮기기를 받지 않는다", () => {
    expect(findSlots(E, { service: "scalp-care", nowMs: NOW, schedule: EMPTY, moveDue: D("2026-10-01") }).ok).toBe(false);
  });
});

describe("칩 표시(F5·F13)", () => {
  it("예약금 안건은 오늘·다음 영업일 칸에 '입금 즉시 확인 필요'", () => {
    const r = ok(findSlots(E, { service: "first-consult", nowMs: NOW, schedule: EMPTY }));
    const urgent = [...new Set(r.slots.filter((s) => s.urgentDeposit).map((s) => s.date))];
    expect(urgent).toEqual(["2026-09-21", "2026-09-22"]);
  });
  it("다음 영업일은 휴진을 건너뛴다(9/23 기준이면 9/28)", () => {
    const r = ok(findSlots(E, { service: "scalp-care", nowMs: at("2026-09-23T10:00"), schedule: EMPTY }));
    expect([...new Set(r.slots.filter((s) => s.urgentDeposit).map((s) => s.date))]).toEqual(["2026-09-23", "2026-09-28"]);
  });
  it("토요일도 영업일이다(10/9 한글날 전날 10/8 기준 → 10/10)", () => {
    const r = ok(findSlots(E, { service: "scalp-care", nowMs: at("2026-10-08T10:00"), schedule: EMPTY }));
    expect([...new Set(r.slots.filter((s) => s.urgentDeposit).map((s) => s.date))]).toEqual(["2026-10-08", "2026-10-10"]);
  });
  it("예약금 없는 안건(주사·재진)에는 붙이지 않는다", () => {
    const r = ok(findSlots(E, { service: "revisit-consult", nowMs: NOW, schedule: EMPTY }));
    expect(r.slots.some((s) => s.urgentDeposit)).toBe(false);
  });
  it("주사 첫 회차: 10회 중 휴진에 걸리는 회차 수(9/21 월 → 10/5 대체공휴일 1회)", () => {
    const r = ok(findSlots(E, { service: "injection", nowMs: NOW, schedule: EMPTY }));
    expect(r.slots[0].injectionClosedHits).toEqual({ closed: 1, unknown: 0, closedDates: ["2026-10-05"] });
    expect(r.slots[0].tags).toEqual(["14일 간격 10회 중 휴진 1회(10/5)"]);
    // 걸리는 회차가 없으면 표시를 달지 않는다("휴진 걸림 0"은 뜻이 안 읽힌다).
    const clean = r.slots.find((s) => s.injectionClosedHits?.closed === 0 && s.injectionClosedHits.unknown === 0);
    expect(clean, "휴진에 안 걸리는 요일 칸").toBeDefined();
    expect(clean!.tags).toEqual([]);
  });
});

describe("날짜별 목록(F4)과 거르개(F12)", () => {
  it("분류가 다른 날은 한 줄로 묶지 않는다(수술: too-soon · 다음 날 휴진 · 휴진)", () => {
    const r = ok(findSlots(E, { service: "surgery-full", nowMs: NOW, schedule: EMPTY }));
    const lines = dayLines(r.days).slice(0, 4).map((l) => `${l.kind}:${l.text}`);
    expect(lines).toEqual([
      "too-soon:9/21(월)~9/22(화) 수술은 기준일 + 7일부터[가정]",
      "service-unavailable:9/23(수) 수술 불가 — 다음 날 9/24(목) 추석 연휴 휴진",
      "closed:9/24(목)~9/27(일) 추석 연휴·일요일 — 휴진",
      "slots:9/28(월)",
    ]);
  });
  it("찾는 기간: 일반 14일, 수술 28일, 늘릴 수 있다", () => {
    expect(ok(findSlots(E, { service: "injection", nowMs: NOW, schedule: EMPTY })).range).toEqual({ from: "2026-09-21", to: "2026-10-04", days: 14 });
    expect(ok(findSlots(E, { service: "surgery-half", nowMs: NOW, schedule: EMPTY })).range.to).toBe("2026-10-18");
    expect(ok(findSlots(E, { service: "injection", nowMs: NOW, schedule: EMPTY, days: 28 })).range.to).toBe("2026-10-18");
  });
  it("저녁 거르개: 18:00 이후 시작 칸만", () => {
    const r = ok(findSlots(E, { service: "first-consult", nowMs: NOW, schedule: EMPTY }));
    const f = applyFilter(r, { bands: ["evening"] });
    expect(f.slots.every((s) => s.start >= "18:00")).toBe(true);
    expect(f.slots.filter((s) => s.date === "2026-10-01").map((s) => s.start)).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00"]);
  });
  it("토요일 거르개에 칸이 없으면 휴진 까닭을 붙인다", () => {
    const r = ok(findSlots(E, { service: "first-consult", nowMs: NOW, schedule: EMPTY }));
    const f = applyFilter(r, { dows: ["sat"] });
    expect(f.slots).toEqual([]);
    expect(f.emptyText).toBe("14일 안에 토요일 빈 시간 없음(9/26 추석 연휴, 10/3 개천절)");
  });
  it("날짜로 이동: 그날부터", () => {
    const r = ok(findSlots(E, { service: "injection", nowMs: NOW, schedule: EMPTY }));
    const f = applyFilter(r, { from: D("2026-10-01") });
    expect(f.slots[0].date).toBe("2026-10-01");
  });
  it("기간 안에 칸이 없으면 '14일 더 보기'", () => {
    // 관리실을 14일 내내 0으로(자원 일정) 두면 두피 관리 칸이 하나도 없다.
    const ex = Array.from({ length: 14 }, (_, i) => ({ date: addDays(TODAY, i), resource: "careRoom", delta: -1, note: "공사" }));
    const r = ok(findSlots(E, { service: "scalp-care", nowMs: NOW, schedule: sched([], ex) }));
    expect(r.slots).toEqual([]);
    // 진료일 8일 = 오늘(today-none) 1 + 예약 꽉 참 7.
    expect(r.days.filter((d) => d.kind === "full").length).toBe(7);
    expect(r.days[0].kind).toBe("today-none");
    expect(applyFilter(r, {}).emptyText).toBe("14일 안에 빈 시간 없음 — 14일 더 보기");
  });
});

describe("제안 칸 — 날짜나 시간대 묶음이 다른 두 칸", () => {
  it("가장 빠른 칸 + 날짜가 다르거나 같은 날 시간대가 다른 가장 빠른 칸", () => {
    const r = ok(findSlots(E, { service: "injection", nowMs: NOW, schedule: EMPTY }));
    const s = suggestSlots(E, r.slots);
    expect(s.map((x) => `${x.date} ${x.start}`)).toEqual(["2026-09-21 11:00", "2026-09-21 12:00"]);
  });
  it("오후 늦게면 다음 날로 넘어간다", () => {
    const r = ok(findSlots(E, { service: "injection", nowMs: at("2026-09-21T16:00"), schedule: EMPTY }));
    expect(suggestSlots(E, r.slots).map((x) => `${x.date} ${x.start}`)).toEqual(["2026-09-21 17:00", "2026-09-21 18:00"]);
    const r2 = ok(findSlots(E, { service: "first-consult", nowMs: at("2026-09-21T17:10"), schedule: EMPTY }));
    expect(suggestSlots(E, r2.slots).map((x) => `${x.date} ${x.start}`)).toEqual(["2026-09-22 10:00", "2026-09-22 12:00"]);
  });
  it("거르개 안에서 고른다", () => {
    const r = ok(findSlots(E, { service: "first-consult", nowMs: NOW, schedule: EMPTY }));
    const s = suggestSlots(E, applyFilter(r, { bands: ["evening"] }).slots);
    expect(s.every((x) => x.band === "evening")).toBe(true);
    expect(s[0].date).not.toBe(s[1].date);
  });
});

describe("결정성", () => {
  const e = engine();
  const s: Schedule = sched([
    bk("first-consult", "2026-09-22", "10:00"),
    bk("first-consult", "2026-09-22", "11:00"),
    bk("revisit-consult", "2026-09-22", "11:00"),
    bk("injection", "2026-09-28", "14:00"),
    bk("surgery-full", "2026-10-01", "10:00"),
    bk("scalp-care", "2026-09-23", "16:00"),
  ]);
  const h = makeHold({ service: "first-consult", date: D("2026-09-23"), start: "10:00", createdAt: "2026-09-21T10:00:00+09:00" });
  const run = (sc: Schedule, now = NOW) => JSON.stringify(findSlots(e, { service: "first-consult", nowMs: now, schedule: sc, holds: [h] }));
  it("같은 입력을 두 번 → 같은 결과", () => expect(run(s)).toBe(run(s)));
  it("예약 순서를 뒤집어도 같은 결과", () => expect(run({ ...s, bookings: [...s.bookings].reverse() })).toBe(run(s)));
  it("기준 시각을 옮겼다가 되돌려도 같은 결과", () => {
    const a = run(s);
    run(s, at("2026-10-01T20:10"));
    expect(run(s)).toBe(a);
  });
  it("모르는 안건·버튼으로 잡지 않는 안건은 오류", () => {
    expect(findSlots(e, { service: "nope", nowMs: NOW, schedule: EMPTY })).toEqual({ ok: false, errors: ["모르는 안건입니다: nope"] });
    expect(findSlots(e, { service: "postop-visit", nowMs: NOW, schedule: EMPTY }).ok).toBe(false);
  });
  it("TODAY는 KST 날짜(자정 직후도 그날)", () => {
    const r = ok(findSlots(e, { service: "injection", nowMs: at("2026-09-22T00:30"), schedule: EMPTY }));
    expect(r.today).toBe("2026-09-22");
    expect(TODAY).toBe("2026-09-21");
  });
});
