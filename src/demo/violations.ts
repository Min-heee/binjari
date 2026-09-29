/**
 * 규칙 위반 검사기(PRD 7절 "규칙 위반"). 앱이 **낸 칸**이 규칙을 어기지 않았는지 칸마다 다시 본다.
 *
 * 엔진의 판정 함수(src/core/slots·schedule·holds의 검사, calendar.checkDay)를 **쓰지 않고 따로 짠다**. 읽는 것은 엔진이 읽어 둔
 * 규칙 **값**(V02 진료시간·점심, B01 단계·수량·준비 시간·하루 최대, B02 공휴일)과 합성 예약뿐이다. 날짜 더하기·요일·분 계산도 여기서 새로 한다.
 * 두 구현이 같은 문서를 읽으므로 구현 실수는 서로 잡지만, 문서를 같은 쪽으로 잘못 읽은 해석 실수는 잡지 못한다(평가 화면에 적는다).
 */

import type { Engine } from "@/core/engine";
import type { Hold } from "@/core/holds";
import type { Schedule } from "@/core/schedule";

export const RULES = [
  { key: "closed", label: "휴진일·공휴일 미확인 날에 낸 칸" },
  { key: "lunch", label: "점심과 겹침" },
  { key: "last-entry", label: "접수 마감 뒤 시작" },
  { key: "past-close", label: "진료 종료 넘김(준비 시간 포함)" },
  { key: "saturday-surgery", label: "수술 없는 요일(토요일) 수술" },
  { key: "next-day-closed", label: "다음 날(D+1) 휴진인 수술" },
  { key: "no-d7", label: "D+7 내원 창에 진료일 없는 수술" },
  { key: "daily-max", label: "하루 최대 초과" },
  { key: "resource", label: "사람·방 수 초과(기존 예약 + 가예약 + 이 칸)" },
  { key: "held", label: "살아 있는 가예약과 같은 칸" },
  { key: "earliest", label: "첫 예약 가능 시각 전" },
] as const;
export type RuleKey = (typeof RULES)[number]["key"];

export interface CheckedSlot {
  service: string;
  date: string;
  start: string;
}

// ── 날짜·시각(여기서 새로 계산) ─────────────────────────────────

const DAY_MS = 86_400_000;
const KST = 9 * 3_600_000;
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function utcOf(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}
function dateOfUtc(ms: number): string {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
const plusDays = (d: string, n: number) => dateOfUtc(utcOf(d) + n * DAY_MS);
const dowOf = (d: string) => DOW[new Date(utcOf(d)).getUTCDay()];
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** KST 날짜·"HH:MM" → ms. */
const instant = (d: string, t: string) => utcOf(d) - KST + hm(t) * 60_000;
const kstDate = (ms: number) => dateOfUtc(ms + KST);

// ── 진료일 ─────────────────────────────────────────────────────

interface DayInfo {
  open: boolean;
  unknown: boolean;
  openMin: number;
  closeMin: number;
}

function dayInfo(engine: Engine, d: string): DayInfo {
  const w = engine.hours.weekly[dowOf(d)];
  const holiday = engine.hours.closedOnPublicHolidays && engine.calendar.holidays.some((h) => h.date === d);
  const extra = engine.hours.extraClosed.some((x) => x.date === d);
  const cov = engine.calendar.holidayCoverage;
  return {
    open: w !== null && !holiday && !extra,
    unknown: engine.hours.closedOnPublicHolidays && (d < cov.from || d > cov.to),
    openMin: w ? hm(w.open) : 0,
    closeMin: w ? hm(w.close) : 0,
  };
}

// ── 자원(여기서 새로 계산) ───────────────────────────────────────

interface Span {
  resource: string;
  from: number;
  to: number;
  count: number;
}

/** 한 안건이 시작 분 start에서 쓰는 자원 구간. 준비 시간은 그 자원을 쓰는 가장 이른 분 앞·가장 늦은 분 뒤에, 수는 그 자원의 가장 큰 수로. */
function spans(engine: Engine, service: string, start: number): Span[] {
  const s = engine.rules.services[service];
  const out: Span[] = [];
  const byRes: Record<string, { lo: number; hi: number; n: number }> = {};
  for (const p of s.phases) {
    for (const r of Object.keys(p.use)) {
      const n = p.use[r];
      out.push({ resource: r, from: start + p.from, to: start + p.to, count: n });
      const cur = byRes[r];
      byRes[r] = cur ? { lo: Math.min(cur.lo, p.from), hi: Math.max(cur.hi, p.to), n: Math.max(cur.n, n) } : { lo: p.from, hi: p.to, n };
    }
  }
  for (const r of Object.keys(byRes)) {
    const b = engine.rules.buffers[r];
    if (!b) continue;
    const x = byRes[r];
    if (b.before) out.push({ resource: r, from: start + x.lo - b.before, to: start + x.lo, count: x.n });
    if (b.after) out.push({ resource: r, from: start + x.hi, to: start + x.hi + b.after, count: x.n });
  }
  return out;
}

function capacityAt(engine: Engine, schedule: Schedule, d: string, r: string, minute: number): number {
  let n = engine.rules.capacity.base[r];
  const dow = dowOf(d);
  for (const o of engine.rules.capacity.overrides) if (o.days.includes(dow) && r in o.set && minute >= hm(o.from) && minute < hm(o.to)) n = o.set[r];
  for (const x of schedule.exceptions) {
    if (x.date !== d || x.resource !== r) continue;
    const f = x.from ? hm(x.from) : 0;
    const t = x.to ? hm(x.to) : 1440;
    if (minute >= f && minute < t) n = Math.max(0, n + x.delta);
  }
  return n;
}

// ── 가예약이 살아 있나(여기서 새로 계산) ────────────────────────

export function holdAlive(engine: Engine, h: Hold, nowMs: number): boolean {
  const created = Date.parse(h.createdAt);
  if (nowMs < created) return false;
  let d = plusDays(kstDate(created), 1);
  for (let i = 0; i < 62; i++, d = plusDays(d, 1)) {
    const info = dayInfo(engine, d);
    if (!info.open) continue;
    if (!engine.rules.businessDaysIncludeSaturday && dowOf(d) === "sat") continue;
    break;
  }
  const close = instant(d, engine.hours.weekly[dowOf(d)]!.close);
  const until = engine.rules.hold.capAtSlotStart ? Math.min(close, instant(h.date, h.start)) : close;
  return nowMs < until;
}

// ── 칸 하나 검사 ─────────────────────────────────────────────────

interface DayLoad {
  /** 자원별 분 사용량(기존 예약 + 살아 있는 가예약). */
  used: Record<string, number[]>;
  /** 자원별 분 수량. */
  cap: Record<string, number[]>;
  counts: Record<string, number>;
}

/**
 * 기존 예약만의 날짜별 점유·수량은 기준 시각과 상관없으므로 한 번만 만든다(base). 살아 있는 가예약은 기준 시각마다 달라지므로
 * at(nowMs)로 기준 시각을 정할 때 다시 고르고, 그 가예약이 있는 날만 base를 복사해 더한다.
 */
export class ViolationChecker {
  private base = new Map<string, DayLoad>();
  private overlay = new Map<string, DayLoad>();
  private live: Hold[] = [];
  private nowMs = Number.NaN;

  constructor(
    private engine: Engine,
    private schedule: Schedule,
    private holds: Hold[],
  ) {}

  /** 기준 시각을 정한다(살아 있는 가예약을 다시 고름). */
  at(nowMs: number): this {
    if (nowMs !== this.nowMs) {
      this.nowMs = nowMs;
      this.live = this.holds.filter((h) => holdAlive(this.engine, h, nowMs));
      this.overlay.clear();
    }
    return this;
  }

  private place(dl: DayLoad, service: string, start: string) {
    dl.counts[service] = (dl.counts[service] ?? 0) + 1;
    for (const s of spans(this.engine, service, hm(start))) for (let m = Math.max(0, s.from); m < Math.min(1440, s.to); m++) dl.used[s.resource][m] += s.count;
  }

  private baseLoad(d: string): DayLoad {
    const hit = this.base.get(d);
    if (hit) return hit;
    const used: Record<string, number[]> = {};
    const cap: Record<string, number[]> = {};
    for (const r of Object.keys(this.engine.rules.resources)) {
      used[r] = new Array<number>(1440).fill(0);
      cap[r] = Array.from({ length: 1440 }, (_, m) => capacityAt(this.engine, this.schedule, d, r, m));
    }
    const dl: DayLoad = { used, cap, counts: {} };
    for (const b of this.schedule.bookings) if (b.date === d) this.place(dl, b.service, b.start);
    this.base.set(d, dl);
    return dl;
  }

  private load(d: string): DayLoad {
    const b = this.baseLoad(d);
    const mine = this.live.filter((h) => h.date === d);
    if (mine.length === 0) return b;
    const hit = this.overlay.get(d);
    if (hit) return hit;
    const used: Record<string, number[]> = {};
    for (const r of Object.keys(b.used)) used[r] = [...b.used[r]];
    const dl: DayLoad = { used, cap: b.cap, counts: { ...b.counts } };
    for (const h of mine) this.place(dl, h.service, h.start);
    this.overlay.set(d, dl);
    return dl;
  }

  /** 어긴 규칙 목록(없으면 빈 배열). */
  check(slot: CheckedSlot): RuleKey[] {
    const { engine } = this;
    const s = engine.rules.services[slot.service];
    const d = slot.date;
    const start = hm(slot.start);
    const end = start + s.minutes;
    const info = dayInfo(engine, d);
    const bad: RuleKey[] = [];
    const surgery = s.earliest === "surgery";
    if (!info.open || info.unknown) {
      bad.push("closed");
      return bad;
    }
    const lunch = engine.hours.lunch;
    if (s.lunch === "avoid" && lunch.days.includes(dowOf(d)) && start < hm(lunch.end) && end > hm(lunch.start)) bad.push("lunch");
    if (start > info.closeMin - engine.hours.lastEntryMinutesBeforeClose) bad.push("last-entry");
    const sp = spans(engine, slot.service, start);
    const lo = Math.min(start, ...sp.map((x) => x.from));
    const hi = Math.max(end, ...sp.map((x) => x.to));
    if (lo < info.openMin || hi > info.closeMin) bad.push("past-close");
    if (surgery) {
      if (engine.hours.noSurgeryDays.includes(dowOf(d))) bad.push("saturday-surgery");
      const next = dayInfo(engine, plusDays(d, 1));
      if (engine.rules.surgeryFollowUps.nextDayMustBeOpen && (!next.open || next.unknown)) bad.push("next-day-closed");
      const w = engine.rules.surgeryFollowUps.d7Window;
      let any = false;
      for (let k = w.from; k <= w.to; k++) {
        const x = dayInfo(engine, plusDays(d, k));
        if (x.open && !x.unknown) any = true;
      }
      if (!any) bad.push("no-d7");
    }
    const dl = this.load(d);
    for (const rule of engine.rules.dailyMax) {
      if (rule.service !== slot.service) continue;
      const n = rule.counts.reduce((a, c) => a + (dl.counts[c] ?? 0), 0);
      if (n + 1 > rule.max) bad.push("daily-max");
    }
    let over = false;
    for (const x of sp) {
      for (let m = x.from; m < x.to && !over; m++) {
        if (m < 0 || m >= 1440 || dl.used[x.resource][m] + x.count > dl.cap[x.resource][m]) over = true;
      }
      if (over) break;
    }
    if (over) bad.push("resource");
    if (this.live.some((h) => h.service === slot.service && h.date === d && h.start === slot.start)) bad.push("held");
    if (surgery) {
      if (utcOf(d) < utcOf(kstDate(this.nowMs)) + engine.rules.surgeryMinDaysAhead * DAY_MS) bad.push("earliest");
    } else if (instant(d, slot.start) < this.nowMs + engine.rules.leadMinutes * 60_000) bad.push("earliest");
    return bad;
  }
}

export interface RuleTally {
  key: RuleKey;
  label: string;
  violations: number;
  /** 이 규칙을 검사한 앱 출력 칸 수(분모). 출력이 0칸이면 위반도 0이 되므로 함께 싣는다. */
  checked: number;
}

export function emptyTally(): RuleTally[] {
  return RULES.map((r) => ({ key: r.key, label: r.label, violations: 0, checked: 0 }));
}

/** 규칙이 그 칸에 해당하는가(분모를 셀 때). 수술 날 조건은 수술 칸만, 점심은 점심을 피하는 안건만, 하루 최대는 최대가 있는 안건만. */
export function applies(engine: Engine, key: RuleKey, service: string): boolean {
  const s = engine.rules.services[service];
  if (key === "saturday-surgery" || key === "next-day-closed" || key === "no-d7") return s.earliest === "surgery";
  if (key === "lunch") return s.lunch === "avoid";
  if (key === "daily-max") return engine.rules.dailyMax.some((r) => r.service === service);
  return true;
}
