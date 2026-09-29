/**
 * 평가(PRD 7절, F10). 모두 합성 데이터 기준이고, 데이터·기대값·코드를 같은 도구(Claude Code)로 만든 편향이 있다.
 * 못 미쳐도 그대로 싣는다. 평가 화면은 서버 컴포넌트라 빌드 때 한 번 계산한다(시험은 더 성긴 간격으로 같은 함수를 부른다).
 *
 * - 규칙 위반: 기준 시각을 9/21 10:00~10/6 19:00에서 stepMinutes마다 바꿔 가며, 앱이 낸 모든 칸을 따로 짠 검사기(violations.ts)로 본다.
 * - 심은 경계 사례: PRD 7절 표. 판정은 앱 엔진(checkSlot)이 한다 — "의도대로 판정됐나"를 보는 것이지 별도 구현 대조가 아니다.
 * - 결정성: 같은 입력 다시, 예약 순서 뒤집기, 기준 시각 왕복.
 * - 조작 수: 설계상 값(버튼 길을 callReducer로 실제로 눌러 센 값). 잰 값이 아니다.
 */

import { formatShort, localDate, parseInstant, type LocalDate } from "@/core/calendar";
import type { Engine } from "@/core/engine";
import { makeHold, type Hold } from "@/core/holds";
import type { ReasonKey } from "@/core/rules";
import type { Schedule } from "@/core/schedule";
import { checkSlot, findSlots, firstBookable, REASON_LABEL, suggestSlots } from "@/core/slots";
import { formatClock, pressPaths, type PressPath } from "./call";
import { DEMO_NOW, DEMO_NOW_MS, DEMO_RANGE } from "./clock";
import { applies, emptyTally, ViolationChecker, type RuleTally } from "./violations";

export const EVAL_SERVICES = ["first-consult", "revisit-consult", "injection", "scalp-care", "surgery-full", "surgery-half"] as const;

export const EVAL_BASES = ["2026-09-21T10:00:00+09:00", "2026-09-23T12:50:00+09:00", "2026-09-28T11:00:00+09:00", "2026-10-01T20:10:00+09:00", "2026-10-06T10:00:00+09:00"] as const;

/**
 * 평가에 넣는 가예약 세 건(기준 시각 9/21 10:00에 만든 것). 기준 시각에 비어 있던 칸에서 정해진 규칙으로 고른다:
 * 첫 상담은 제안 두 번째 칸, 두피 주사는 첫 칸, 수술(하루)은 첫 칸. 가예약이 살아 있는 동안(다음 영업일 19:00, 칸 시작까지) 규칙 위반 검사에 들어간다.
 */
export function demoHolds(engine: Engine, schedule: Schedule): Hold[] {
  const pick = (service: string, which: (slots: { date: LocalDate; start: string }[]) => { date: LocalDate; start: string } | undefined): Hold[] => {
    const r = findSlots(engine, { service, nowMs: DEMO_NOW_MS, schedule });
    if (!r.ok) return [];
    const s = which(service === "first-consult" ? suggestSlots(engine, r.slots) : r.slots);
    return s ? [makeHold({ service, date: s.date, start: s.start, createdAt: DEMO_NOW, memo: "평가용" })] : [];
  };
  return [...pick("first-consult", (x) => x[1]), ...pick("injection", (x) => x[0]), ...pick("surgery-full", (x) => x[0])];
}

export interface SweepResult {
  stepMinutes: number;
  times: number;
  /** 앱이 낸 칸(기준 시각 × 안건마다 다시 센 합). */
  slots: number;
  rules: RuleTally[];
  examples: string[];
}

/** 규칙 위반(PRD 7절). from~to를 stepMinutes마다. */
export function sweepViolations(engine: Engine, schedule: Schedule, holds: Hold[], opts: { stepMinutes: number; from?: number; to?: number; services?: readonly string[] }): SweepResult {
  const tally = emptyTally();
  const examples: string[] = [];
  const services = opts.services ?? EVAL_SERVICES;
  let times = 0;
  let slots = 0;
  const checker = new ViolationChecker(engine, schedule, holds);
  for (let t = opts.from ?? DEMO_RANGE.from; t <= (opts.to ?? DEMO_RANGE.to); t += opts.stepMinutes * 60_000) {
    times++;
    checker.at(t);
    for (const service of services) {
      const r = findSlots(engine, { service, nowMs: t, schedule, holds });
      if (!r.ok) {
        examples.push(`${service} @${t}: ${r.errors.join(", ")}`);
        continue;
      }
      for (const s of r.slots) {
        slots++;
        const bad = checker.check({ service, date: s.date, start: s.start });
        for (const row of tally) {
          if (!applies(engine, row.key, service)) continue;
          row.checked++;
          if (bad.includes(row.key)) {
            row.violations++;
            if (examples.length < 10) examples.push(`${service} ${s.date} ${s.start} (기준 ${t}): ${row.label}`);
          }
        }
      }
    }
  }
  return { stepMinutes: opts.stepMinutes, times, slots, rules: tally, examples };
}

// ── 심은 경계 사례 ───────────────────────────────────────────────

export interface Boundary {
  label: string;
  service: string;
  date: LocalDate;
  start: string;
  base: string;
  /** null = 가능. 아니면 까닭 집합에 들어 있어야 할 까닭. */
  expect: ReasonKey | null;
}

const B = (label: string, service: string, date: string, start: string, expect: ReasonKey | null, base: string = EVAL_BASES[0]): Boundary => ({ label, service, date: localDate(date), start, base, expect });
const B1006 = EVAL_BASES[4];

export const BOUNDARIES: Boundary[] = [
  B("점심과 맞닿기만 함", "first-consult", "2026-09-22", "12:00", null),
  B("점심 겹침", "first-consult", "2026-09-22", "12:30", "lunch"),
  B("점심 전에 끝나는 주사", "injection", "2026-09-22", "12:30", null),
  B("점심 직후", "first-consult", "2026-09-22", "14:00", null),
  B("평일 마지막 60분 칸", "first-consult", "2026-09-22", "18:00", null),
  B("진료 종료 넘김", "first-consult", "2026-09-22", "18:30", "past-close"),
  B("접수 마감 포함", "injection", "2026-09-22", "18:30", null),
  B("목요일 야간 자원 안", "first-consult", "2026-10-01", "20:00", null),
  B("목요일 진료 종료 넘김", "first-consult", "2026-10-01", "20:30", "past-close"),
  B("목요일 접수 마감 포함", "injection", "2026-10-01", "20:30", null),
  B("토요일 마지막 60분 칸", "first-consult", "2026-10-10", "14:00", null, B1006),
  B("토요일 진료 종료 넘김", "first-consult", "2026-10-10", "14:30", "past-close", B1006),
  B("토요일 접수 마감 포함", "injection", "2026-10-10", "14:30", null, B1006),
  B("평범한 토요일 수술", "surgery-full", "2026-10-10", "10:00", "no-surgery-day", B1006),
  B("다음 날 10/3 개천절", "surgery-full", "2026-10-02", "10:00", "next-day-closed"),
  B("다음 날 10/9 한글날", "surgery-full", "2026-10-08", "10:00", "next-day-closed"),
  B("다음 날 10/16 임시 휴진", "surgery-full", "2026-10-15", "10:00", "next-day-closed", B1006),
  B("다음 날 10/2 진료", "surgery-full", "2026-10-01", "10:00", null),
  B("다음 날 토요일 진료", "surgery-full", "2026-10-23", "10:00", null, B1006),
  B("수술실 정리 18:00~18:30이 진료 종료 안", "surgery-full", "2026-09-28", "10:00", null),
  ...EVAL_SERVICES.map((s) => B("10/16 임시 휴진", s, "2026-10-16", s.startsWith("surgery") ? "10:00" : "11:00", "closed", B1006)),
  B("공휴일 확인 기간 밖(2028-01-04)", "first-consult", "2028-01-04", "11:00", "holiday-unknown"),
];

export interface BoundaryResult extends Boundary {
  reasons: ReasonKey[];
  pass: boolean;
}

export function runBoundaries(engine: Engine, schedule: Schedule): BoundaryResult[] {
  return BOUNDARIES.map((b) => {
    const c = checkSlot(engine, { service: b.service, nowMs: parseInstant(b.base), schedule }, b.date, b.start);
    const pass = b.expect === null ? c.reasons.length === 0 : c.reasons.includes(b.expect);
    return { ...b, reasons: c.reasons, pass };
  });
}

export interface DayCase {
  label: string;
  expect: string;
  actual: string;
  pass: boolean;
}

/** 날 단위·첫 예약 가능 시각 사례(PRD 7절 표의 나머지 행). */
export function runDayCases(engine: Engine, schedule: Schedule): DayCase[] {
  const out: DayCase[] = [];
  const r = findSlots(engine, { service: "first-consult", nowMs: DEMO_NOW_MS, schedule });
  const d930 = r.ok ? r.days.find((d) => d.date === "2026-09-30") : undefined;
  out.push({ label: "9/30(수) 첫 상담 — 의료진 1명 휴무 + 합성 수술", expect: "예약 꽉 참", actual: d930 ? (d930.kind === "full" ? "예약 꽉 참" : `${d930.kind} ${d930.slots.length}칸`) : "(없음)", pass: d930?.kind === "full" });
  const firsts: [string, string][] = [
    ["2026-09-21T10:00:00+09:00", "9/21(월) 11:00"],
    ["2026-09-21T11:00:00+09:00", "9/21(월) 12:00"],
    ["2026-09-23T12:50:00+09:00", "9/23(수) 14:00"],
    ["2026-10-01T20:10:00+09:00", "10/2(금) 10:00"],
  ];
  for (const [base, expect] of firsts) {
    const fb = firstBookable(engine, parseInstant(base));
    const inj = findSlots(engine, { service: "injection", nowMs: parseInstant(base), schedule });
    const first = inj.ok ? inj.slots[0] : undefined;
    const actual = `${formatShort(fb.date)} ${fb.time}`;
    const slotText = first ? `${formatShort(first.date)} ${first.start}` : "(없음)";
    out.push({ label: `주사 첫 예약 가능 시각 — 기준 ${base.slice(5, 16).replace("T", " ")}`, expect, actual: actual === slotText ? actual : `${actual} (첫 칸 ${slotText})`, pass: actual === expect && slotText === expect });
  }
  return out;
}

// ── 결정성 ───────────────────────────────────────────────────────

export interface Determinism {
  total: number;
  changed: number;
  details: string[];
}

export function runDeterminism(engine: Engine, schedule: Schedule, holds: Hold[]): Determinism {
  const reversed: Schedule = { ...schedule, bookings: [...schedule.bookings].reverse() };
  const snap = (s: Schedule, service: string, t: number) => JSON.stringify(findSlots(engine, { service, nowMs: t, schedule: s, holds }));
  let total = 0;
  let changed = 0;
  const details: string[] = [];
  for (const base of EVAL_BASES) {
    const t = parseInstant(base);
    for (const service of EVAL_SERVICES) {
      const first = snap(schedule, service, t);
      const cases: [string, () => string][] = [
        ["같은 입력 다시", () => snap(schedule, service, t)],
        ["예약 순서 뒤집기", () => snap(reversed, service, t)],
        [
          "기준 시각 왕복(+3일 뒤 되돌림)",
          () => {
            snap(schedule, service, t + 3 * 86_400_000);
            return snap(schedule, service, t);
          },
        ],
      ];
      for (const [name, run] of cases) {
        total++;
        if (run() !== first) {
          changed++;
          details.push(`${base} ${service}: ${name}`);
        }
      }
    }
  }
  return { total, changed, details };
}

// ── 한데 모으기 ──────────────────────────────────────────────────

export interface EvalReport {
  sweep: SweepResult;
  boundaries: BoundaryResult[];
  dayCases: DayCase[];
  determinism: Determinism;
  presses: PressPath[];
  holds: Hold[];
  firstSlots: { service: string; label: string; count: number; first: string[] }[];
}

export function buildReport(engine: Engine, schedule: Schedule, stepMinutes: number): EvalReport {
  const holds = demoHolds(engine, schedule);
  const firstSlots = EVAL_SERVICES.map((service) => {
    const r = findSlots(engine, { service, nowMs: DEMO_NOW_MS, schedule });
    return {
      service,
      label: engine.rules.services[service].label,
      count: r.ok ? r.slots.length : 0,
      first: r.ok ? r.slots.slice(0, 5).map((s) => `${formatShort(s.date)} ${s.start}`) : [],
    };
  });
  return {
    sweep: sweepViolations(engine, schedule, holds, { stepMinutes }),
    boundaries: runBoundaries(engine, schedule),
    dayCases: runDayCases(engine, schedule),
    determinism: runDeterminism(engine, schedule, holds),
    presses: pressPaths({ engine, schedule, holds: [], nowMs: DEMO_NOW_MS }),
    holds,
    firstSlots,
  };
}

export const reasonText = (rs: ReasonKey[]) => (rs.length === 0 ? "가능" : `불가(${rs.map((r) => REASON_LABEL[r]).join(", ")})`);

/** 기준 시각을 바꿔 본 범위(평가 화면 머리). */
export function sweepRangeText(): string {
  return `${formatClock(DEMO_RANGE.from)} ~ ${formatClock(DEMO_RANGE.to)}`;
}
