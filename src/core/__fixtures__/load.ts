import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localDate, parseInstant } from "../calendar";
import { loadEngine, type Engine } from "../engine";
import { parseSchedule, type Schedule } from "../schedule";

/**
 * 테스트 전용: 저장소의 볼트(vault/)와 합성 예약(data/bookings.json)을 읽는다.
 * 규칙 값이 바뀌면 경계 시험이 함께 깨지게 일부러 사본이 아니라 원본을 읽는다(B01 값이 곧 시험의 기대값 근거).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function vaultFiles(): { path: string; raw: string }[] {
  return readdirSync(join(ROOT, "vault"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({ path: `vault/${f}`, raw: readFileSync(join(ROOT, "vault", f), "utf8") }));
}

/** 파일 하나를 고친 볼트(규칙 깨짐 시험용). */
export function vaultWith(path: string, edit: (raw: string) => string): { path: string; raw: string }[] {
  let hit = false;
  const out = vaultFiles().map((f) => {
    if (f.path !== path) return f;
    hit = true;
    return { ...f, raw: edit(f.raw) };
  });
  if (!hit) throw new Error(`볼트에 없는 파일: ${path}`);
  return out;
}

export function repoFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 시연 기준 시각: 2026-09-21(월) 10:00 KST. */
export const NOW = parseInstant("2026-09-21T10:00:00+09:00");
export const TODAY = localDate("2026-09-21");

export function at(iso: string): number {
  return parseInstant(iso.includes("+") || iso.endsWith("Z") ? iso : `${iso}:00+09:00`);
}

export function engine(): Engine {
  const r = loadEngine(vaultFiles(), TODAY);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.engine;
}

export function engineWithB01(edit: (json: Record<string, unknown>) => void): Engine {
  const files = vaultWith("vault/booking-slots.md", (raw) => {
    const m = /```json\n([\s\S]*?)\n```/.exec(raw)!;
    const j = JSON.parse(m[1]) as Record<string, unknown>;
    edit(j);
    return raw.replace(m[1], JSON.stringify(j, null, 2));
  });
  const r = loadEngine(files, TODAY);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.engine;
}

export const EMPTY: Schedule = { bookings: [], exceptions: [] };

export function schedule(e: Engine = engine()): Schedule {
  const r = parseSchedule(JSON.parse(repoFile("data/bookings.json")), e);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.schedule;
}
