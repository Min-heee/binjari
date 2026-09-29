/**
 * 화면이 쓰는 엔진·합성 예약. 번들(src/generated/bundle.json)에서 한 번 읽는다.
 * 볼트나 예약 파일이 깨졌으면 ok: false와 오류 목록을 돌려준다 — 화면은 빈 시간을 내지 않고 "규칙 오류 — 예약표에서 직접 확인"을 보인다(F2).
 */

import bundle from "@/generated/bundle.json";
import { loadEngine, type Engine } from "@/core/engine";
import { parseSchedule, type Schedule } from "@/core/schedule";
import { DEMO_TODAY } from "./clock";

export type DemoData = { ok: true; engine: Engine; schedule: Schedule } | { ok: false; errors: string[] };

export function loadDemo(): DemoData {
  const e = loadEngine(bundle.vaultFiles, DEMO_TODAY);
  if (!e.ok) return { ok: false, errors: e.errors };
  const s = parseSchedule(bundle.bookings, e.engine);
  if (!s.ok) return { ok: false, errors: s.errors.map((x) => `data/bookings.json: ${x}`) };
  return { ok: true, engine: e.engine, schedule: s.schedule };
}

let cached: DemoData | undefined;

/** 화면용: 번들을 한 번만 읽는다(볼트 파싱·광고 표현 검사가 화면을 그릴 때마다 돌지 않게). */
export function demo(): DemoData {
  cached ??= loadDemo();
  return cached;
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
