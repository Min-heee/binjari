/**
 * 바깥에서 넣어 주는 시연 입력(선택). 기본은 꺼져 있고, 그때 빈자리는 번들(샘플의원)과 DEMO_NOW 그대로다.
 *
 * 빌드 때 NEXT_PUBLIC_BINJARI_FEED=1이면 화면은 브라우저의 window.__BINJARI_FEED__(feed.js가 넣음)에서
 * 기준 시각·기존 예약·의원 이름을 읽는다. 다른 앱(한창구)이 이 빌드를 품을 때 쓰는 길이다.
 * 기준 시각도 바깥에서 받은 값일 뿐이라 이 저장소 코드는 여전히 시계를 읽지 않는다(PRD F3).
 * 모양이 틀리면 기본값으로 넘어가지 않고 멈춘다(F2와 같은 원칙).
 */

import { isInstant, parseInstant } from "@/core/calendar";

export const FEED_MODE = process.env.NEXT_PUBLIC_BINJARI_FEED === "1";
export const FEED_SRC = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/feed.js`;
/** feed.js가 값을 넣은 뒤 보내는 이벤트. 화면은 이것을 기다린다. */
export const FEED_EVENT = "binjari-feed";
/** 이만큼 기다려도 feed.js가 없으면 오류 화면을 보인다. */
export const FEED_WAIT_MS = 4000;

export interface Feed {
  nowMs: number;
  clinicName: string;
  sourceLabel: string;
  bookings: unknown;
}

export type FeedResult = { ok: true; feed: Feed } | { ok: false; errors: string[] };

const KEYS = ["v", "now", "clinicName", "sourceLabel", "bookings"];

export function parseFeed(raw: unknown): FeedResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, errors: ["feed가 객체가 아닙니다"] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) errors.push(`feed 모르는 키입니다: ${k}`);
  if (o.v !== 1) errors.push(`feed 판이 다릅니다: ${String(o.v)}`);
  if (typeof o.now !== "string" || !isInstant(o.now) || !o.now.endsWith("+09:00")) errors.push("feed.now는 +09:00이 붙은 ISO 시각이어야 합니다");
  for (const k of ["clinicName", "sourceLabel"]) if (typeof o[k] !== "string" || (o[k] as string).trim() === "") errors.push(`feed.${k}가 비었습니다`);
  if (o.bookings === undefined) errors.push("feed.bookings가 없습니다");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, feed: { nowMs: parseInstant(o.now as string), clinicName: o.clinicName as string, sourceLabel: o.sourceLabel as string, bookings: o.bookings } };
}

/** 브라우저에서만 의미가 있다. 서버(빌드)에서는 늘 null. */
export function readFeed(): FeedResult | null {
  if (typeof window === "undefined") return null;
  const g = globalThis as { __BINJARI_FEED__?: unknown };
  return g.__BINJARI_FEED__ === undefined ? { ok: false, errors: ["feed.js를 읽지 못했습니다(window.__BINJARI_FEED__ 없음)"] } : parseFeed(g.__BINJARI_FEED__);
}
