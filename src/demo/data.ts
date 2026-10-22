/**
 * 화면이 쓰는 엔진·합성 예약. 번들(src/generated/bundle.json)에서 한 번 읽는다.
 * 볼트나 예약 파일이 깨졌으면 ok: false와 오류 목록을 돌려준다 — 화면은 빈 시간을 내지 않고 "규칙 오류 — 예약표에서 직접 확인"을 보인다(F2).
 * 바깥 입력(src/demo/feed.ts)이 켜진 빌드의 브라우저에서는 기준 시각·기존 예약을 그 입력에서 읽는다.
 */

import bundle from "@/generated/bundle.json";
import { kstDateOf } from "@/core/calendar";
import { loadEngine, type Engine } from "@/core/engine";
import { parseSchedule, type Schedule } from "@/core/schedule";
import { DEMO_NOW_MS, DEMO_TODAY } from "./clock";
import { currentFeedObject, FEED_MODE, readFeed } from "./feed";

export type DemoData = { ok: true; engine: Engine; schedule: Schedule } | { ok: false; errors: string[] };

export function loadDemo(): DemoData {
  return loadDemoFrom(bundle.bookings, DEMO_TODAY, "data/bookings.json");
}

export function loadDemoFrom(bookings: unknown, today: ReturnType<typeof kstDateOf>, where: string): DemoData {
  const e = loadEngine(bundle.vaultFiles, today);
  if (!e.ok) return { ok: false, errors: e.errors };
  const s = parseSchedule(bookings, e.engine);
  if (!s.ok) return { ok: false, errors: s.errors.map((x) => `${where}: ${x}`) };
  return { ok: true, engine: e.engine, schedule: s.schedule };
}

export interface DemoSource {
  data: DemoData;
  nowMs: number;
  clinicName: string | null;
  sourceLabel: string | null;
}

let cached: DemoSource | undefined;
/** cached를 만든 바깥 입력. feed.js를 다시 읽으면 새 객체가 들어오므로 그때 다시 만든다. */
let cachedFrom: unknown = null;

function loadSource(): DemoSource {
  const f = FEED_MODE ? readFeed() : null;
  if (f === null) return { data: loadDemo(), nowMs: DEMO_NOW_MS, clinicName: null, sourceLabel: null };
  if (!f.ok) return { data: { ok: false, errors: f.errors.map((x) => `feed.js: ${x}`) }, nowMs: DEMO_NOW_MS, clinicName: null, sourceLabel: null };
  return { data: loadDemoFrom(f.feed.bookings, kstDateOf(f.feed.nowMs), "feed.js bookings"), nowMs: f.feed.nowMs, clinicName: f.feed.clinicName, sourceLabel: f.feed.sourceLabel };
}

/** 화면용: 입력이 같으면 한 번만 읽는다(볼트 파싱·광고 표현 검사가 화면을 그릴 때마다 돌지 않게). */
export function demoSource(): DemoSource {
  const from = FEED_MODE ? currentFeedObject() : null;
  if (cached === undefined || from !== cachedFrom) {
    cached = loadSource();
    cachedFrom = from;
  }
  return cached;
}

export function demo(): DemoData {
  return demoSource().data;
}

/** 기준 시각. 기본은 DEMO_NOW_MS, 바깥 입력이 있으면 그 값. */
export function demoNowMs(): number {
  return demoSource().nowMs;
}

/** demo().ok를 확인한 뒤에 쓴다. */
export function mustDemo(): { engine: Engine; schedule: Schedule } {
  const d = demo();
  if (!d.ok) throw new Error(`규칙 오류: ${d.errors.join(" / ")}`);
  return d;
}

/** 규칙 보기 화면: 번들에 든 볼트 문서 원문. */
export function vaultSources(): { path: string; raw: string }[] {
  return bundle.vaultFiles;
}

export const BUNDLE_AS_OF: string = bundle.asOf;
