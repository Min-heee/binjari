/**
 * 가예약(PRD F7). 고객이 고른 칸을 이 기기(브라우저) 안에서만 잡아 두고, 모든 안건 계산에서 자원·하루 최대를 차지하게 한다.
 *
 * 유지 기간은 입금 기한[가정, B01 hold]: 가예약한 날의 다음 영업일 진료 종료까지, 단 칸 시작 시각을 넘지 않는다.
 * 살아 있는지는 **시연 시계**(기준 시각)로 판단한다: 만든 시각 ≤ 기준 시각 < 풀리는 시각. 그래서 기준 시각을 앞으로 옮기면 풀리고,
 * 뒤로 되돌리면 다시 보인다(만들기 전 시각으로 되돌리면 아직 없다).
 *
 * 저장(localStorage)은 화면 몫이다. 여기서는 저장값을 검증하고, 모양이 틀리면 **모두 버린다**(일부만 살리면 어느 것이 빠졌는지 모른다).
 */

import { addDays, dowKey, formatShort, hoursOn, isLocalDate, kstDateOf, kstInstant, parseHhmm, parseInstant, shiftToOpenDay, type LocalDate } from "./calendar";
import type { Engine } from "./engine";
import { maskPii } from "./mask";

export interface Hold {
  id: string;
  service: string;
  date: LocalDate;
  start: string;
  /** 가예약한 시각(시간대가 적힌 ISO). 시연 시계 기준. */
  createdAt: string;
  /** 선택. 전화번호 모양은 저장 전에 가린다. */
  memo: string;
}

/** 다음 영업일(그날은 빼고). 영업일은 진료일이고, B01 businessDaysIncludeSaturday가 false면 토요일을 건너뛴다. */
export function nextBusinessDay(engine: Engine, d: LocalDate): LocalDate {
  let cur = addDays(d, 1);
  for (let i = 0; i < 62; i++) {
    const shifted = shiftToOpenDay(cur, engine.calendar).date;
    if (engine.rules.businessDaysIncludeSaturday || dowKey(shifted) !== "sat") return shifted;
    cur = addDays(shifted, 1);
  }
  throw new Error(`${d} 뒤 62일 동안 영업일이 없습니다. 달력 자료를 확인하세요`);
}

/** 풀리는 시각(ms). */
export function holdExpiryMs(engine: Engine, hold: Pick<Hold, "date" | "start" | "createdAt">): number {
  const created = parseInstant(hold.createdAt);
  const next = nextBusinessDay(engine, kstDateOf(created));
  const hours = hoursOn(next, engine.calendar)!;
  const until = kstInstant(next, hours.close);
  const slotStart = kstInstant(hold.date, hold.start);
  return engine.rules.hold.capAtSlotStart ? Math.min(until, slotStart) : until;
}

export type HoldState = "not-yet" | "alive" | "expiring" | "expired";

export function holdState(engine: Engine, hold: Hold, nowMs: number): HoldState {
  const created = parseInstant(hold.createdAt);
  if (nowMs < created) return "not-yet";
  const exp = holdExpiryMs(engine, hold);
  if (nowMs >= exp) return "expired";
  return nowMs >= exp - engine.rules.hold.warnMinutesBefore * 60_000 ? "expiring" : "alive";
}

/** 기준 시각에 살아 있는(곧 풀림 포함) 가예약만. 입력 순서를 지킨다. */
export function liveHolds(engine: Engine, holds: Hold[], nowMs: number): Hold[] {
  return holds.filter((h) => {
    const s = holdState(engine, h, nowMs);
    return s === "alive" || s === "expiring";
  });
}

/** 메모 칸: 전화번호·이메일 등은 가려서 저장한다(한창구 mask.ts). 이름은 막지 못하므로 화면이 "이름·연락처를 쓰지 마세요"를 보인다. */
export function cleanMemo(memo: string): string {
  return maskPii(memo.trim().slice(0, 80)).masked;
}

export function makeHold(args: { service: string; date: LocalDate; start: string; createdAt: string; memo?: string }): Hold {
  return {
    id: `H-${args.date}-${args.start.replace(":", "")}-${args.service}-${args.createdAt}`,
    service: args.service,
    date: args.date,
    start: args.start,
    createdAt: args.createdAt,
    memo: cleanMemo(args.memo ?? ""),
  };
}

export type StoredHolds = { holds: Hold[]; discarded: false } | { holds: []; discarded: true; reason: string };

/** localStorage에서 읽은 값 검증. 하나라도 모양이 틀리면 모두 버리고 까닭을 돌려준다(화면이 알림을 띄운다). */
export function parseStoredHolds(raw: unknown, engine: Engine): StoredHolds {
  if (raw === null || raw === undefined) return { holds: [], discarded: false };
  const bad = (reason: string): StoredHolds => ({ holds: [], discarded: true, reason });
  if (!Array.isArray(raw)) return bad("저장값이 배열이 아닙니다");
  const out: Hold[] = [];
  const ids = new Set<string>();
  for (const h of raw) {
    if (typeof h !== "object" || h === null) return bad("가예약 항목이 객체가 아닙니다");
    const o = h as Record<string, unknown>;
    const keys = Object.keys(o).sort().join(",");
    if (keys !== "createdAt,date,id,memo,service,start") return bad(`가예약 항목의 키가 틀렸습니다: ${keys}`);
    if (typeof o.id !== "string" || ids.has(o.id)) return bad("가예약 ID가 틀렸거나 겹칩니다");
    ids.add(o.id);
    const svc = typeof o.service === "string" ? engine.rules.services[o.service] : undefined;
    if (!svc || !svc.bookable) return bad(`모르는 안건입니다: ${String(o.service)}`);
    if (!isLocalDate(o.date) || typeof o.start !== "string" || parseHhmm(o.start) === null) return bad("가예약 날짜·시각이 틀렸습니다");
    if (typeof o.createdAt !== "string") return bad("가예약 시각이 틀렸습니다");
    try {
      parseInstant(o.createdAt);
    } catch {
      return bad("가예약 시각이 틀렸습니다");
    }
    if (typeof o.memo !== "string" || o.memo.length > 80) return bad("메모가 틀렸습니다");
    out.push({ id: o.id, service: o.service as string, date: o.date, start: o.start, createdAt: o.createdAt, memo: o.memo });
  }
  return { holds: out, discarded: false };
}

/** "9/23(수) 19:00" — 풀리는 시각을 직원에게 보일 때. */
export function formatExpiry(engine: Engine, hold: Hold): string {
  const ms = holdExpiryMs(engine, hold);
  const d = kstDateOf(ms);
  const min = Math.round((ms - kstInstant(d, "00:00")) / 60_000);
  return `${formatShort(d)} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
