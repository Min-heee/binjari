/**
 * 빈 시간 찾기(PRD F3·F4·F5·F12·F13). 순수 함수: 입력(엔진 = 규칙·달력, 기존 예약·자원 일정, 가예약, 기준 시각, 안건, 창)이
 * 같으면 결과가 같다. 시계를 읽지 않는다(기준 시각은 인자). 날짜·시각은 KST 날짜 문자열과 자정부터의 분으로만 센다.
 *
 * 찾는 법(PRD 6절 "찾기 방식"): 기간 안의 모든 시작 후보(여는 시각 기준 격자, 수술은 B01 시작 후보 목록)를 늘어놓고 전부 검사한다.
 * 후보마다 떨어진 까닭을 **집합**으로 남기고(reasons), B01 reasonOrder로 대표 까닭 하나(primary)를 고른다.
 * 휴진일·공휴일 미확인 날은 후보를 늘어놓지 않고 날짜 한 줄만 남긴다.
 *
 * 검사(F3 ①~⑨):
 *  ① 진료일(closed) · 공휴일 확인 범위 안(holiday-unknown)
 *  ② 안건이 되는 날 — 수술: 토요일 아님(no-surgery-day), D+1 진료일(next-day-closed), D+6~D+9에 진료일 하나 이상(no-d7-open-day)
 *  ③ 첫 예약 가능 시각 이후(before-earliest) — 수술은 기준일 + 7일부터
 *  ④ 접수 마감 **이하** 시작(after-last-entry)   ⑤ 준비 시간까지 진료 종료 이하에 끝남(past-close)
 *  ⑥ 점심과 겹치지 않음(lunch, 수술은 가로질러 진행)   ⑦ 하루 최대 미만(daily-max, 가예약 포함)
 *  ⑧ 자원: 구간 안 모든 분에서 사용량 + 필요량 ≤ 수량(resource, 가예약 때문에 모자라면 held)
 *  ⑨ 주사 회차 옮기기 창 안(outside-window)
 */

import {
  addDays,
  checkDay,
  diffDays,
  DOW_KEYS,
  DOW_KO,
  dowKey,
  formatHhmm,
  formatShort,
  hoursOn,
  kstDateOf,
  kstMinuteOfDay,
  parseHhmm,
  type ClosedReason,
  type DowKey,
  type LocalDate,
} from "./calendar";
import type { Engine } from "./engine";
import { liveHolds, nextBusinessDay, type Hold } from "./holds";
import type { ReasonKey, ServiceRule } from "./rules";
import { capacityOn, footprint, shortResources, usageOf, usedOn, type Placed, type Schedule } from "./schedule";

export type Band = "morning" | "afternoon" | "evening";
export const BAND_LABEL: Record<Band, string> = { morning: "오전", afternoon: "낮·오후", evening: "저녁" };

export const REASON_LABEL: Record<ReasonKey, string> = {
  closed: "휴진",
  "holiday-unknown": "공휴일 미확인 — 계산하지 않음",
  "no-surgery-day": "수술 없는 날",
  "next-day-closed": "다음 날 휴진",
  "no-d7-open-day": "D+7 내원 창에 진료일 없음",
  "outside-window": "옮길 수 있는 창 밖",
  "before-earliest": "첫 예약 가능 시각 전",
  "after-last-entry": "접수 마감 뒤",
  "past-close": "진료 종료 넘김",
  lunch: "점심과 겹침",
  "daily-max": "하루 최대",
  held: "가예약",
  resource: "사람·방 없음",
};

export interface SearchInput {
  service: string;
  nowMs: number;
  schedule: Schedule;
  holds?: Hold[];
  /** 찾는 날 수(기준일 포함). 없으면 B01 searchDays(수술은 surgery). */
  days?: number;
  /** 두피 주사 회차 옮기기: 예정일. 창(B01 injectionMoveWindow) 안의 날만 찾는다. */
  moveDue?: LocalDate;
}

export interface Candidate {
  date: LocalDate;
  start: string;
  end: string;
  /** 떨어진 까닭 집합(B01 reasonOrder 순). 비어 있으면 낼 수 있는 칸. */
  reasons: ReasonKey[];
  primary: ReasonKey | null;
  /** 모자란 자원(resource·held일 때). */
  short: string[];
}

export interface Slot {
  date: LocalDate;
  start: string;
  end: string;
  band: Band;
  /** 오늘·다음 영업일이고 예약금이 있는 안건: "입금 즉시 확인 필요". */
  urgentDeposit: boolean;
  /** 칸 옆 짧은 안내(직원용, F5). */
  tags: string[];
  /** 수술: 다음 날 내원일. */
  nextDay?: LocalDate;
  /** 주사 첫 회차: 이 요일로 2주 간격 10회를 잡으면 휴진에 걸리는 회차 수(F13). */
  injectionClosedHits?: { closed: number; unknown: number; closedDates: LocalDate[] };
}

export type DayKind = "slots" | "closed" | "holiday-unknown" | "service-unavailable" | "too-soon" | "today-none" | "full";

export interface DayResult {
  date: LocalDate;
  kind: DayKind;
  /** 후보(휴진·미확인 날은 비어 있음). */
  candidates: Candidate[];
  slots: Slot[];
  /** 휴진 사유 이름("추석 연휴", "일요일", "임시 휴진(내부 교육)"). */
  closedLabels: string[];
  /** 빈 시간 없는 날의 한 줄 까닭. slots 날은 "". */
  message: string;
}

export type SearchResult =
  | {
      ok: true;
      service: ServiceRule;
      today: LocalDate;
      nowMs: number;
      range: { from: LocalDate; to: LocalDate; days: number };
      moveDue?: LocalDate;
      days: DayResult[];
      slots: Slot[];
      /** 안건 공통 안내(B01 notes). */
      notes: string[];
      /** 옮기기 창에 빈 시간이 없을 때 V08 안내. */
      windowNote?: string;
    }
  | { ok: false; errors: string[] };

const min = (hhmm: string) => parseHhmm(hhmm)!;

export function bandOf(engine: Engine, start: string): Band {
  const m = min(start);
  if (m < min(engine.rules.bands.morningBefore)) return "morning";
  if (m >= min(engine.rules.bands.eveningFrom)) return "evening";
  return "afternoon";
}

export function closedLabel(r: ClosedReason): string {
  if (r.kind === "weekly") return `${DOW_KO[DOW_KEYS.indexOf(r.dow)]}요일`;
  if (r.kind === "holiday") return r.name;
  return `임시 휴진(${r.reason})`;
}

/** 대표 까닭: B01 reasonOrder에서 가장 앞선 것. */
export function primaryReason(engine: Engine, reasons: ReasonKey[]): ReasonKey | null {
  for (const r of engine.rules.reasonOrder) if (reasons.includes(r)) return r;
  return null;
}

function sortReasons(engine: Engine, set: Set<ReasonKey>): ReasonKey[] {
  return engine.rules.reasonOrder.filter((r) => set.has(r));
}

/**
 * 첫 예약 가능 시각(수술 외, PRD 5.2): 기준 시각 + leadMinutes 이후의 첫 격자(여는 시각 기준).
 * 점심 안이면 점심 끝, 접수 마감을 넘기면 다음 진료일 여는 시각. 화면 표시와 시험용이다 — 후보 검사는 ③에서 따로 한다.
 */
export function firstBookable(engine: Engine, nowMs: number): { date: LocalDate; time: string } {
  const t = nowMs + engine.rules.leadMinutes * 60_000;
  let d = kstDateOf(t);
  let m = kstMinuteOfDay(t);
  for (let i = 0; i < 62; i++) {
    const c = checkDay(d, engine.calendar);
    const h = hoursOn(d, engine.calendar);
    if (c.open && h) {
      const open = min(h.open);
      const last = min(h.close) - engine.hours.lastEntryMinutesBeforeClose;
      const step = engine.rules.slotMinutes;
      let g = m <= open ? open : open + Math.ceil((m - open) / step) * step;
      const lunchDays = engine.hours.lunch.days;
      if (lunchDays.includes(dowKey(d)) && g >= min(engine.hours.lunch.start) && g < min(engine.hours.lunch.end)) g = min(engine.hours.lunch.end);
      if (g <= last) return { date: d, time: formatHhmm(g) };
    }
    d = addDays(d, 1);
    m = 0;
  }
  throw new Error("62일 안에 진료일이 없습니다");
}

interface Ctx {
  engine: Engine;
  nowMs: number;
  today: LocalDate;
  /** 첫 예약 가능 시각의 날짜·분(기준 시각 + lead, 올리지 않은 값 — 격자 후보와 비교하면 올림과 같다). */
  leadDate: LocalDate;
  leadMin: number;
  schedule: Schedule;
  holds: Hold[];
  moveDue?: LocalDate;
  cache: Map<LocalDate, DayLoad>;
}

interface DayLoad {
  cap: Record<string, Int16Array>;
  used: Record<string, Int16Array>;
  usedNoHolds: Record<string, Int16Array>;
  placed: Placed[];
}

function load(ctx: Ctx, d: LocalDate): DayLoad {
  const hit = ctx.cache.get(d);
  if (hit) return hit;
  const bookings = ctx.schedule.bookings.filter((b) => b.date === d);
  const holds = ctx.holds.filter((h) => h.date === d);
  const placed: Placed[] = [...bookings, ...holds];
  const out = {
    cap: capacityOn(ctx.engine, d, ctx.schedule.exceptions),
    used: usedOn(ctx.engine, d, placed),
    usedNoHolds: usedOn(ctx.engine, d, bookings),
    placed,
  };
  ctx.cache.set(d, out);
  return out;
}

function makeCtx(engine: Engine, input: Pick<SearchInput, "nowMs" | "schedule" | "holds" | "moveDue">): Ctx {
  const t = input.nowMs + engine.rules.leadMinutes * 60_000;
  return {
    engine,
    nowMs: input.nowMs,
    today: kstDateOf(input.nowMs),
    leadDate: kstDateOf(t),
    leadMin: kstMinuteOfDay(t),
    schedule: input.schedule,
    holds: liveHolds(engine, input.holds ?? [], input.nowMs),
    ...(input.moveDue ? { moveDue: input.moveDue } : {}),
    cache: new Map(),
  };
}

interface DayCheckResult {
  /** 휴진·미확인이면 후보를 늘어놓지 않는다. */
  skip: boolean;
  reasons: Set<ReasonKey>;
  closedLabels: string[];
  /** 수술 불가 까닭 문장(직원용). */
  serviceMessage: string[];
}

function isSurgery(s: ServiceRule): boolean {
  return s.earliest === "surgery";
}

/** 날 단위 검사(①②⑨와 수술의 ③). */
function checkServiceDay(ctx: Ctx, s: ServiceRule, d: LocalDate): DayCheckResult {
  const { engine } = ctx;
  const reasons = new Set<ReasonKey>();
  const c = checkDay(d, engine.calendar);
  const closedLabels = c.reasons.map(closedLabel);
  if (!c.open) reasons.add("closed");
  if (c.holidayUnknown) reasons.add("holiday-unknown");
  if (reasons.size > 0) return { skip: true, reasons, closedLabels, serviceMessage: [] };

  const serviceMessage: string[] = [];
  if (isSurgery(s)) {
    if (engine.hours.noSurgeryDays.includes(dowKey(d))) {
      reasons.add("no-surgery-day");
      serviceMessage.push(`수술 없는 날(${DOW_KO[DOW_KEYS.indexOf(dowKey(d))]}요일, V02)`);
    }
    if (engine.rules.surgeryFollowUps.nextDayMustBeOpen) {
      const n = addDays(d, 1);
      const nc = checkDay(n, engine.calendar);
      if (nc.holidayUnknown) reasons.add("holiday-unknown");
      else if (!nc.open) {
        reasons.add("next-day-closed");
        const labels = nc.reasons.map(closedLabel).join("·");
        serviceMessage.push(`수술 불가 — 다음 날 ${formatShort(n)} ${labels.includes("휴진") ? labels : `${labels} 휴진`}`);
      }
    }
    const w = engine.rules.surgeryFollowUps.d7Window;
    let known = 0;
    let unknown = 0;
    for (let k = w.from; k <= w.to; k++) {
      const wc = checkDay(addDays(d, k), engine.calendar);
      if (wc.holidayUnknown) unknown++;
      else if (wc.open) known++;
    }
    if (known === 0) {
      if (unknown > 0) reasons.add("holiday-unknown");
      else {
        reasons.add("no-d7-open-day");
        serviceMessage.push(`수술 불가 — D+7 내원 창(${formatShort(addDays(d, w.from))}~${formatShort(addDays(d, w.to))})에 진료일 없음`);
      }
    }
    if (diffDays(ctx.today, d) < engine.rules.surgeryMinDaysAhead) reasons.add("before-earliest");
    if (reasons.has("holiday-unknown")) return { skip: true, reasons, closedLabels, serviceMessage };
  }
  if (ctx.moveDue) {
    const w = engine.rules.injectionMoveWindow;
    const off = diffDays(ctx.moveDue, d);
    if (off < -w.before || off > w.after) reasons.add("outside-window");
  }
  return { skip: false, reasons, closedLabels, serviceMessage };
}

/** 한 후보(날짜·시작)를 검사한다. 날 단위 까닭도 함께 담는다. */
function evaluate(ctx: Ctx, s: ServiceRule, d: LocalDate, start: number, day: DayCheckResult): Candidate {
  const { engine } = ctx;
  const reasons = new Set(day.reasons);
  const h = hoursOn(d, engine.calendar)!;
  const open = min(h.open);
  const close = min(h.close);
  const end = start + s.minutes;

  // ③ 첫 예약 가능 시각(수술 외)
  if (s.earliest === "lead" && (d < ctx.leadDate || (d === ctx.leadDate && start < ctx.leadMin))) reasons.add("before-earliest");
  // ④ 접수 마감 이하 시작(포함)
  if (start > close - engine.hours.lastEntryMinutesBeforeClose) reasons.add("after-last-entry");
  // ⑤ 준비 시간까지 진료시간 안
  const fp = footprint(engine.rules, s, start);
  if (fp.to > close || fp.from < open) reasons.add("past-close");
  // ⑥ 점심(반개구간 겹침)
  const lunch = engine.hours.lunch;
  if (s.lunch === "avoid" && lunch.days.includes(dowKey(d)) && start < min(lunch.end) && end > min(lunch.start)) reasons.add("lunch");

  const dl = load(ctx, d);
  // ⑦ 하루 최대(가예약 포함, counts에 있는 안건만 센다)
  for (const rule of engine.rules.dailyMax) {
    if (rule.service !== s.key) continue;
    const n = dl.placed.filter((p) => rule.counts.includes(p.service)).length;
    if (n >= rule.max) reasons.add("daily-max");
  }
  // ⑧ 자원
  const usages = usageOf(engine.rules, s, start);
  let short = shortResources(usages, dl.used, dl.cap);
  if (short.length > 0) {
    const withoutHolds = shortResources(usages, dl.usedNoHolds, dl.cap);
    if (withoutHolds.length === 0) reasons.add("held");
    else {
      reasons.add("resource");
      short = withoutHolds;
    }
  }
  const sorted = sortReasons(engine, reasons);
  return { date: d, start: formatHhmm(start), end: formatHhmm(Math.min(end, 1439)), reasons: sorted, primary: primaryReason(engine, sorted), short };
}

function startsFor(engine: Engine, s: ServiceRule, d: LocalDate): number[] {
  const h = hoursOn(d, engine.calendar)!;
  if (s.starts !== "grid") return s.starts.map(min);
  const out: number[] = [];
  for (let m = min(h.open); m < min(h.close); m += engine.rules.slotMinutes) out.push(m);
  return out;
}

function injectionHits(engine: Engine, d: LocalDate): { closed: number; unknown: number; closedDates: LocalDate[] } {
  const { intervalDays, sessions } = engine.rules.injectionProgram;
  let closed = 0;
  let unknown = 0;
  const closedDates: LocalDate[] = [];
  for (let k = 0; k < sessions; k++) {
    const day = addDays(d, k * intervalDays);
    const c = checkDay(day, engine.calendar);
    if (!c.open) {
      closed++;
      closedDates.push(day);
    } else if (c.holidayUnknown) unknown++;
  }
  return { closed, unknown, closedDates };
}

function toSlot(ctx: Ctx, s: ServiceRule, c: Candidate, urgentDays: Set<LocalDate>): Slot {
  const { engine } = ctx;
  const tags: string[] = [];
  const urgent = s.deposit !== null && urgentDays.has(c.date);
  if (urgent) tags.push("입금 즉시 확인 필요");
  const slot: Slot = { date: c.date, start: c.start, end: c.end, band: bandOf(engine, c.start), urgentDeposit: urgent, tags };
  if (isSurgery(s)) {
    if (engine.rules.surgeryFollowUps.nextDayMustBeOpen) {
      slot.nextDay = addDays(c.date, 1);
      tags.push(`다음 날 내원 ${formatShort(slot.nextDay)}`);
    }
    const notice = engine.rules.surgeryCancelNoticeDays;
    if (diffDays(ctx.today, c.date) < notice) tags.push(`${notice}일 안 수술 — 취소·변경은 원무팀 개별 안내(V04)`);
  }
  if (s.key === "injection" && !ctx.moveDue) {
    slot.injectionClosedHits = injectionHits(engine, c.date);
    // 0이면 숨긴다. 걸리면 어느 날짜인지 보인다(상담실장 점검: "휴진 걸림 0"은 뜻이 안 읽힌다).
    const { closed, unknown, closedDates } = slot.injectionClosedHits;
    const { sessions: n, intervalDays: gap } = engine.rules.injectionProgram;
    const md = (x: LocalDate) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
    if (closed > 0) tags.push(`${gap}일 간격 ${n}회 중 휴진 ${closed}회(${closedDates.map(md).join(", ")})`);
    if (unknown > 0) tags.push(`${gap}일 간격 ${n}회 중 공휴일 미확인 ${unknown}회`);
  }
  return slot;
}

function todayNoneMessage(ctx: Ctx, d: LocalDate): string {
  const h = hoursOn(d, ctx.engine.calendar);
  const last = h ? min(h.close) - ctx.engine.hours.lastEntryMinutesBeforeClose : -1;
  return ctx.leadDate > d || ctx.leadMin > last ? "오늘은 진료 종료" : "첫 예약 가능 시각 이후 빈 시간 없음";
}

function classify(ctx: Ctx, s: ServiceRule, d: LocalDate, day: DayCheckResult, candidates: Candidate[], slots: Slot[]): Pick<DayResult, "kind" | "message"> {
  if (day.reasons.has("closed")) return { kind: "closed", message: "휴진" };
  if (day.reasons.has("holiday-unknown")) return { kind: "holiday-unknown", message: REASON_LABEL["holiday-unknown"] };
  if (slots.length > 0) return { kind: "slots", message: "" };
  // 까닭이 여럿이면(토요일이면서 다음 날 일요일) 우선순위가 가장 앞선 것 하나만 보인다(PRD 5.2 떨어진 까닭 우선순위).
  if (day.serviceMessage.length > 0) return { kind: "service-unavailable", message: day.serviceMessage[0] };
  if (isSurgery(s) && day.reasons.has("before-earliest")) return { kind: "too-soon", message: `수술은 기준일 + ${ctx.engine.rules.surgeryMinDaysAhead}일부터[가정]` };
  if (d === ctx.today) return { kind: "today-none", message: todayNoneMessage(ctx, d) };
  if (candidates.every((c) => c.reasons.includes("before-earliest"))) return { kind: "today-none", message: "첫 예약 가능 시각 전" };
  // 시작 칸마다 진료 종료나 접수 마감을 넘기면(토요일 단축 진료에 하루짜리 수술 등) 예약과 상관없이 안 되는 날이다 — '꽉 참'이 아니다.
  // (진료 종료 뒤에는 사람·방 수가 0이라 자원 부족도 함께 붙는다.)
  if (candidates.length > 0 && candidates.every((c) => c.reasons.includes("past-close") || c.reasons.includes("after-last-entry")))
    return { kind: "service-unavailable", message: "진료시간 안에 끝나지 않음" };
  return { kind: "full", message: "예약 꽉 참" };
}

/** 한 칸만 검사한다(시험·"왜 이 시간이 안 되나" 설명용). 휴진·미확인 날이면 날 단위 까닭만 담는다. */
export function checkSlot(engine: Engine, input: Omit<SearchInput, "days">, date: LocalDate, start: string): Candidate {
  const s = engine.rules.services[input.service];
  if (!s) throw new Error(`모르는 안건입니다: ${input.service}`);
  const ctx = makeCtx(engine, input);
  const day = checkServiceDay(ctx, s, date);
  if (day.skip) {
    const reasons = sortReasons(engine, day.reasons);
    return { date, start, end: formatHhmm(Math.min(min(start) + s.minutes, 1439)), reasons, primary: primaryReason(engine, reasons), short: [] };
  }
  return evaluate(ctx, s, date, min(start), day);
}

export function findSlots(engine: Engine, input: SearchInput): SearchResult {
  const s = engine.rules.services[input.service];
  if (!s) return { ok: false, errors: [`모르는 안건입니다: ${input.service}`] };
  if (!s.bookable) return { ok: false, errors: [`버튼으로 잡지 않는 안건입니다: ${s.label}`] };
  if (input.moveDue && s.key !== "injection") return { ok: false, errors: ["회차 옮기기는 두피 주사만 됩니다"] };
  const ctx = makeCtx(engine, input);
  const n = input.days ?? (isSurgery(s) ? engine.rules.searchDays.surgery : engine.rules.searchDays.default);
  if (!Number.isInteger(n) || n < 1 || n > 180) return { ok: false, errors: [`찾는 날 수가 틀렸습니다: ${n}`] };

  let from = ctx.today;
  let to = addDays(ctx.today, n - 1);
  if (input.moveDue) {
    const w = engine.rules.injectionMoveWindow;
    const wf = addDays(input.moveDue, -w.before);
    from = wf > ctx.today ? wf : ctx.today;
    to = addDays(input.moveDue, w.after);
  }

  // 오늘·다음 영업일("입금 즉시 확인 필요")
  const urgentDays = new Set<LocalDate>([ctx.today]);
  try {
    urgentDays.add(nextBusinessDay(engine, ctx.today));
  } catch {
    // 62일 넘게 진료일이 없으면 오늘만 본다(달력 자료가 이상한 경우).
  }

  const days: DayResult[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = checkServiceDay(ctx, s, d);
    if (day.skip) {
      const kind = day.reasons.has("closed") ? "closed" : "holiday-unknown";
      days.push({ date: d, kind, candidates: [], slots: [], closedLabels: day.closedLabels, message: kind === "closed" ? "휴진" : REASON_LABEL["holiday-unknown"] });
      continue;
    }
    const candidates = startsFor(engine, s, d).map((m) => evaluate(ctx, s, d, m, day));
    const slots = candidates.filter((c) => c.reasons.length === 0).map((c) => toSlot(ctx, s, c, urgentDays));
    days.push({ date: d, candidates, slots, closedLabels: day.closedLabels, ...classify(ctx, s, d, day, candidates, slots) });
  }
  const slots = days.flatMap((x) => x.slots);
  return {
    ok: true,
    service: s,
    today: ctx.today,
    nowMs: input.nowMs,
    range: { from, to, days: from <= to ? diffDays(from, to) + 1 : 0 },
    ...(input.moveDue ? { moveDue: input.moveDue } : {}),
    days,
    slots,
    notes: s.notes,
    ...(input.moveDue && slots.length === 0 ? { windowNote: engine.rules.injectionMoveWindow.outsideNote } : {}),
  };
}

// ── 날짜별 한 줄(F4) ─────────────────────────────────────────────

export interface DayLine {
  kind: DayKind;
  from: LocalDate;
  to: LocalDate;
  /** 칸이 있는 날은 slots, 없는 날은 text. */
  slots: Slot[];
  text: string;
  /** 휴진 줄의 사유("추석 연휴·일요일"). 다른 줄은 빈 글. */
  reason: string;
}

export function formatRange(from: LocalDate, to: LocalDate): string {
  return from === to ? formatShort(from) : `${formatShort(from)}~${formatShort(to)}`;
}

/** "추석"과 "추석 연휴"가 함께 있으면 "추석 연휴"만 남긴다(PRD 3절 "추석 연휴·일요일"). */
function mergeLabels(labels: string[]): string[] {
  const uniq = [...new Set(labels)];
  return uniq.filter((l) => !uniq.some((o) => o !== l && o.startsWith(`${l} `)));
}

/**
 * 날짜별 목록을 줄로 묶는다. 칸이 있는 날은 하루 한 줄, 칸이 없는 날은 **같은 분류·같은 까닭**끼리 이어진 날을 한 줄로 묶는다.
 * 분류가 다른 날(휴진 ↔ 이 안건만 안 되는 날 ↔ 예약 꽉 참)은 한 구간으로 묶지 않는다(PRD F4).
 */
export function dayLines(days: DayResult[]): DayLine[] {
  const out: DayLine[] = [];
  let cur: { kind: DayKind; from: LocalDate; to: LocalDate; message: string; labels: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const reason = cur.kind === "closed" ? mergeLabels(cur.labels).join("·") : "";
    const text = cur.kind === "closed" ? `${formatRange(cur.from, cur.to)} ${reason} — 휴진` : `${formatRange(cur.from, cur.to)} ${cur.message}`;
    out.push({ kind: cur.kind, from: cur.from, to: cur.to, slots: [], text, reason });
    cur = null;
  };
  for (const d of days) {
    if (d.kind === "slots") {
      flush();
      out.push({ kind: "slots", from: d.date, to: d.date, slots: d.slots, text: formatShort(d.date), reason: "" });
      continue;
    }
    if (cur && cur.kind === d.kind && (d.kind === "closed" || cur.message === d.message) && addDays(cur.to, 1) === d.date) {
      cur.to = d.date;
      cur.labels.push(...d.closedLabels);
    } else {
      flush();
      cur = { kind: d.kind, from: d.date, to: d.date, message: d.message, labels: [...d.closedLabels] };
    }
  }
  flush();
  return out;
}

// ── 거르개(F12)와 제안 칸 ─────────────────────────────────────────

export interface SlotFilter {
  dows?: DowKey[];
  bands?: Band[];
  /** 날짜로 이동: 이 날짜부터. */
  from?: LocalDate;
}

export interface Filtered {
  days: DayResult[];
  slots: Slot[];
  /** 조건 안에 칸이 없을 때의 한 줄. */
  emptyText: string | null;
}

function slotPasses(f: SlotFilter, s: Slot): boolean {
  if (f.dows && f.dows.length > 0 && !f.dows.includes(dowKey(s.date))) return false;
  if (f.bands && f.bands.length > 0 && !f.bands.includes(s.band)) return false;
  if (f.from && s.date < f.from) return false;
  return true;
}

export function applyFilter(result: Extract<SearchResult, { ok: true }>, f: SlotFilter): Filtered {
  const days = result.days
    .filter((d) => !f.from || d.date >= f.from)
    .filter((d) => !f.dows || f.dows.length === 0 || f.dows.includes(dowKey(d.date)))
    .map((d) => (d.kind === "slots" ? { ...d, slots: d.slots.filter((s) => slotPasses(f, s)) } : d))
    .map((d) => (d.kind === "slots" && d.slots.length === 0 ? { ...d, kind: "full" as const, message: "조건에 맞는 빈 시간 없음" } : d));
  const slots = days.flatMap((d) => (d.kind === "slots" ? d.slots : []));
  let emptyText: string | null = null;
  if (slots.length === 0) {
    const parts: string[] = [];
    if (f.dows && f.dows.length > 0) parts.push(f.dows.map((w) => `${DOW_KO[DOW_KEYS.indexOf(w)]}요일`).join("·"));
    if (f.bands && f.bands.length > 0) parts.push(f.bands.map((b) => BAND_LABEL[b]).join("·"));
    const head = `${f.from ? `${formatShort(f.from)}부터 ` : ""}${result.range.days}일 안에 ${parts.length > 0 ? `${parts.join(" ")} ` : ""}빈 시간 없음`;
    const closed = days.filter((d) => d.kind === "closed" && f.dows && f.dows.length > 0);
    const why = closed.map((d) => `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))} ${mergeLabels(d.closedLabels).join("·")}`);
    emptyText = why.length > 0 ? `${head}(${why.join(", ")})` : parts.length === 0 && !f.from ? `${head} — ${result.range.days}일 더 보기` : head;
  }
  return { days, slots, emptyText };
}

/**
 * 제안 칸(B01 suggestCount, PRD 5.2): 가장 빠른 칸 하나, 그다음은 앞서 고른 칸들과 **날짜가 다르거나 같은 날이면 시간대 묶음이 다른**
 * 가장 빠른 칸. 붙어 있는 세 칸(10:00·10:30·11:00)을 읽지 않게 한다.
 */
export function suggestSlots(engine: Engine, slots: Slot[]): Slot[] {
  const sorted = [...slots].sort((a, b) => (a.date === b.date ? (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) : a.date < b.date ? -1 : 1));
  const picked: Slot[] = [];
  for (const s of sorted) {
    if (picked.length >= engine.rules.suggestCount) break;
    if (picked.every((p) => p.date !== s.date || p.band !== s.band)) picked.push(s);
  }
  return picked;
}
