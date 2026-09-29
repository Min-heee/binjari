/**
 * 가예약의 브라우저 저장 모양(PRD F7). 가예약은 이 브라우저 localStorage에만 남는다(막히면 이번 방문 동안 메모리).
 *
 * 저장값은 누구나 고칠 수 있는 바깥 입력이다. 읽을 때 core/holds.parseStoredHolds로 모양을 보고,
 * 하나라도 틀리면 **모두 버리고** 까닭을 돌려준다(화면이 한 줄로 알린다). 일부만 살리면 어느 가예약이 빠졌는지 모른다.
 */

import type { Engine } from "@/core/engine";
import { makeHold, parseStoredHolds, type Hold } from "@/core/holds";
import { formatKstIso, type LocalDate } from "@/core/calendar";

export const HOLDS_KEY = "binjari.holds.v1";

export function serializeHolds(holds: Hold[]): string {
  return JSON.stringify({ v: 1, holds });
}

export type ParsedHolds = { holds: Hold[]; dropped: string | null };

export function parseHoldsRaw(raw: string | null, engine: Engine): ParsedHolds {
  if (raw === null || raw === "") return { holds: [], dropped: null };
  try {
    const j: unknown = JSON.parse(raw);
    if (typeof j !== "object" || j === null || Array.isArray(j)) return { holds: [], dropped: "저장값 모양이 틀렸습니다" };
    const o = j as Record<string, unknown>;
    if (o.v !== 1 || Object.keys(o).sort().join(",") !== "holds,v") return { holds: [], dropped: "저장값 판이 다릅니다" };
    const r = parseStoredHolds(o.holds, engine);
    return r.discarded ? { holds: [], dropped: r.reason } : { holds: r.holds, dropped: null };
  } catch {
    return { holds: [], dropped: "저장값을 읽을 수 없습니다" };
  }
}

/**
 * 가예약 하나 더하기. 시각은 기준 시각(시연 시계). 같은 안건·날짜·시각이 이미 있으면(두 번 누름, 풀린 가예약) 그것을 새것으로 바꾼다 —
 * 시연 시계가 멈춰 있어 ID가 같게 나오므로, 쌓으면 ID가 겹쳐 다음에 읽을 때 저장값 전체가 버려진다.
 */
export function addHold(holds: Hold[], args: { service: string; date: LocalDate; start: string; nowMs: number; memo?: string }): { holds: Hold[]; hold: Hold } {
  const hold = makeHold({ service: args.service, date: args.date, start: args.start, createdAt: formatKstIso(args.nowMs), memo: args.memo ?? "" });
  const rest = holds.filter((h) => h.id !== hold.id && !(h.service === args.service && h.date === args.date && h.start === args.start));
  return { holds: [...rest, hold], hold };
}

export function removeHold(holds: Hold[], id: string): Hold[] {
  return holds.filter((h) => h.id !== id);
}
