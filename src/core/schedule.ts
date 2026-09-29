/**
 * 기존 예약·자원 일정 읽기와 자원 점유 계산(PRD F3 ⑧, F8).
 *
 * 자원은 이름 없는 수량이다(PRD 6절). 예약에 이름 있는 배정 칸(assigned)이 있어도 읽기만 하고 계산에 쓰지 않는다.
 * 점유는 분 단위 배열로 센다: 한 날의 [0, 1440)분마다 자원별 사용량과 수량을 두고, 후보 구간 안 **모든 분**에서
 * 사용량 + 필요량 ≤ 수량인지 본다. 구간은 [시작, 끝) 반개구간이라 끝과 다음 시작이 맞닿아도 겹치지 않는다.
 */

import { dowKey, isLocalDate, parseHhmm, type LocalDate } from "./calendar";
import type { Engine } from "./engine";
import type { ServiceRule, SlotRules } from "./rules";

export interface Booking {
  id: string;
  service: string;
  date: LocalDate;
  /** "HH:MM" KST */
  start: string;
  /** 이름 있는 배정(합성). 엔진은 무시한다. */
  assigned?: Record<string, string>;
}

/** 날짜별 자원 수량 증감(합성 자원 일정). from·to가 없으면 하루 종일. */
export interface ResourceException {
  date: LocalDate;
  resource: string;
  delta: number;
  from?: string;
  to?: string;
  note: string;
}

export interface Schedule {
  bookings: Booking[];
  exceptions: ResourceException[];
}

export const MINUTES_PER_DAY = 1440;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** data/bookings.json → Schedule. 모르는 안건·자원, 틀린 날짜·시각, 겹치는 ID는 거부한다(추측해서 넘기지 않는다). */
export function parseSchedule(json: unknown, engine: Engine): { ok: true; schedule: Schedule } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(json) || !Array.isArray(json.bookings) || !Array.isArray(json.exceptions)) return { ok: false, errors: ["예약 파일은 { bookings: [], exceptions: [] }여야 합니다"] };
  const services = engine.rules.services;
  const bookings: Booking[] = [];
  const ids = new Set<string>();
  json.bookings.forEach((b, i) => {
    const w = `bookings[${i}]`;
    if (!isObj(b)) return errors.push(`${w}가 객체가 아닙니다`);
    for (const k of Object.keys(b)) if (!["id", "service", "date", "start", "assigned"].includes(k)) errors.push(`${w} 모르는 키입니다: ${k}`);
    if (typeof b.id !== "string" || b.id === "" || ids.has(b.id)) return errors.push(`${w}.id가 비었거나 겹칩니다`);
    ids.add(b.id);
    if (typeof b.service !== "string" || !services[b.service]) return errors.push(`${w}.service가 B01에 없는 안건입니다: ${String(b.service)}`);
    if (!isLocalDate(b.date)) return errors.push(`${w}.date가 틀렸습니다: ${String(b.date)}`);
    if (typeof b.start !== "string" || parseHhmm(b.start) === null) return errors.push(`${w}.start가 틀렸습니다: ${String(b.start)}`);
    if (b.assigned !== undefined && (!isObj(b.assigned) || !Object.values(b.assigned).every((v) => typeof v === "string"))) return errors.push(`${w}.assigned 모양이 틀렸습니다`);
    bookings.push({ id: b.id, service: b.service, date: b.date, start: b.start, ...(b.assigned !== undefined ? { assigned: b.assigned as Record<string, string> } : {}) });
  });
  const exceptions: ResourceException[] = [];
  json.exceptions.forEach((x, i) => {
    const w = `exceptions[${i}]`;
    if (!isObj(x)) return errors.push(`${w}가 객체가 아닙니다`);
    for (const k of Object.keys(x)) if (!["date", "resource", "delta", "from", "to", "note"].includes(k)) errors.push(`${w} 모르는 키입니다: ${k}`);
    if (!isLocalDate(x.date)) return errors.push(`${w}.date가 틀렸습니다`);
    if (typeof x.resource !== "string" || !(x.resource in engine.rules.resources)) return errors.push(`${w}.resource가 B01에 없는 자원입니다: ${String(x.resource)}`);
    if (typeof x.delta !== "number" || !Number.isInteger(x.delta) || x.delta === 0) return errors.push(`${w}.delta는 0이 아닌 정수여야 합니다`);
    if (typeof x.note !== "string" || x.note.trim() === "") return errors.push(`${w}.note가 비었습니다`);
    const f = x.from === undefined ? 0 : typeof x.from === "string" ? parseHhmm(x.from) : null;
    const t = x.to === undefined ? MINUTES_PER_DAY : typeof x.to === "string" ? parseHhmm(x.to) : null;
    if (f === null || t === null || f >= t) return errors.push(`${w} 시각이 틀렸습니다`);
    exceptions.push({ date: x.date, resource: x.resource, delta: x.delta, note: x.note, ...(x.from !== undefined ? { from: x.from as string } : {}), ...(x.to !== undefined ? { to: x.to as string } : {}) });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, schedule: { bookings, exceptions } };
}

/** 한 안건이 한 자원을 쓰는 구간(자정부터의 분, [from, to)). */
export interface Usage {
  resource: string;
  from: number;
  to: number;
  count: number;
}

/**
 * 시작 분 `start`에 놓인 안건이 쓰는 자원 구간 전부. 단계(phases)와 자원별 준비 시간(buffers)을 붙인다.
 * 준비 시간은 그 자원을 쓰는 첫 단계 앞(before)과 마지막 단계 뒤(after)에 붙고, 수량은 그 자원의 단계 중 가장 큰 값이다.
 * 새 후보·기존 예약·가예약에 똑같이 쓴다(PRD 5.2 "앞뒤 준비 시간").
 */
export function usageOf(rules: SlotRules, service: ServiceRule, start: number): Usage[] {
  const out: Usage[] = [];
  const span = new Map<string, { from: number; to: number; count: number }>();
  for (const p of service.phases) {
    for (const [r, n] of Object.entries(p.use)) {
      out.push({ resource: r, from: start + p.from, to: start + p.to, count: n });
      const s = span.get(r);
      span.set(r, s ? { from: Math.min(s.from, p.from), to: Math.max(s.to, p.to), count: Math.max(s.count, n) } : { from: p.from, to: p.to, count: n });
    }
  }
  for (const [r, s] of span) {
    const b = rules.buffers[r];
    if (!b) continue;
    if (b.before > 0) out.push({ resource: r, from: start + s.from - b.before, to: start + s.from, count: s.count });
    if (b.after > 0) out.push({ resource: r, from: start + s.to, to: start + s.to + b.after, count: s.count });
  }
  return out;
}

/** 준비 시간까지 붙인 안건 전체가 차지하는 구간 [from, to). 진료시간 안에 들어가는지 볼 때 쓴다. */
export function footprint(rules: SlotRules, service: ServiceRule, start: number): { from: number; to: number } {
  const u = usageOf(rules, service, start);
  return { from: Math.min(start, ...u.map((x) => x.from)), to: Math.max(start + service.minutes, ...u.map((x) => x.to)) };
}

/** 한 날의 자원별 분 단위 수량(B01 기본 수량 → 요일·시간대 수량 → 날짜별 증감, 0 밑으로 내려가지 않음). */
export function capacityOn(engine: Engine, date: LocalDate, exceptions: ResourceException[]): Record<string, Int16Array> {
  const { capacity } = engine.rules;
  const dow = dowKey(date);
  const out: Record<string, Int16Array> = {};
  for (const r of Object.keys(engine.rules.resources)) {
    const arr = new Int16Array(MINUTES_PER_DAY).fill(capacity.base[r]);
    for (const o of capacity.overrides) {
      if (!o.days.includes(dow) || !(r in o.set)) continue;
      arr.fill(o.set[r], parseHhmm(o.from)!, parseHhmm(o.to)!);
    }
    for (const x of exceptions) {
      if (x.date !== date || x.resource !== r) continue;
      const f = x.from === undefined ? 0 : parseHhmm(x.from)!;
      const t = x.to === undefined ? MINUTES_PER_DAY : parseHhmm(x.to)!;
      for (let m = f; m < t; m++) arr[m] = Math.max(0, arr[m] + x.delta);
    }
    out[r] = arr;
  }
  return out;
}

export interface Placed {
  service: string;
  date: LocalDate;
  start: string;
}

/** 여러 예약(또는 가예약)의 자원별 분 단위 사용량. 날짜가 다른 것은 뺀다. 순서와 상관없이 같은 결과(더하기만 한다). */
export function usedOn(engine: Engine, date: LocalDate, placed: Placed[]): Record<string, Int16Array> {
  const out: Record<string, Int16Array> = {};
  for (const r of Object.keys(engine.rules.resources)) out[r] = new Int16Array(MINUTES_PER_DAY);
  for (const p of placed) {
    if (p.date !== date) continue;
    const svc = engine.rules.services[p.service];
    if (!svc) continue;
    for (const u of usageOf(engine.rules, svc, parseHhmm(p.start)!)) {
      const arr = out[u.resource];
      for (let m = Math.max(0, u.from); m < Math.min(MINUTES_PER_DAY, u.to); m++) arr[m] += u.count;
    }
  }
  return out;
}

/** 필요량을 더하면 수량을 넘는 자원 이름들(없으면 빈 배열). 구간 안 모든 분을 본다. */
export function shortResources(usages: Usage[], used: Record<string, Int16Array>, cap: Record<string, Int16Array>): string[] {
  const short = new Set<string>();
  for (const u of usages) {
    if (short.has(u.resource)) continue;
    for (let m = u.from; m < u.to; m++) {
      if (m < 0 || m >= MINUTES_PER_DAY || used[u.resource][m] + u.count > cap[u.resource][m]) {
        short.add(u.resource);
        break;
      }
    }
  }
  return [...short].sort();
}

/**
 * 기존 예약이 이미 수량을 넘는 분이 있는지(합성 데이터 검사용). 넘는 날짜·자원·첫 분을 돌려준다.
 * 엔진은 넘는 예약이 있어도 멈추지 않는다 — 그날 그 자원을 쓰는 칸이 모두 빠질 뿐이다.
 */
export function overbooked(engine: Engine, schedule: Schedule): { date: LocalDate; resource: string; minute: number }[] {
  const out: { date: LocalDate; resource: string; minute: number }[] = [];
  const dates = [...new Set(schedule.bookings.map((b) => b.date))].sort();
  for (const d of dates) {
    const used = usedOn(engine, d, schedule.bookings);
    const cap = capacityOn(engine, d, schedule.exceptions);
    for (const r of Object.keys(used)) {
      for (let m = 0; m < MINUTES_PER_DAY; m++) {
        if (used[r][m] > cap[r][m]) {
          out.push({ date: d, resource: r, minute: m });
          break;
        }
      }
    }
  }
  return out;
}
