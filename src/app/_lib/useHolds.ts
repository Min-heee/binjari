"use client";

/**
 * 이 브라우저의 가예약(PRD F7, src/demo/holdStore.ts). **기본 저장소는 이 모듈의 메모리 변수**이고, localStorage는 쓸 수 있을 때만 맞춰 둔다.
 * 다시봄 useContactLog와 같은 구조다: 저장이 막힌 브라우저(사생활 보호 모드 등)에서도 이번 방문 동안은 가예약이 먹통이 되지 않고,
 * 새로 고치면 사라질 뿐이다(화면에 한 줄로 알린다).
 *
 * useSyncExternalStore: 정적으로 미리 그린 화면(가예약 없음)과 브라우저 저장값이 달라도 하이드레이션이 깨지지 않고,
 * 띠(가예약 n건)·목록·시트가 같은 값을 본다. 다른 탭에서 바꾼 가예약도 storage 이벤트로 따라온다.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { LocalDate } from "@/core/calendar";
import type { Hold } from "@/core/holds";
import { mustDemo } from "@/demo/data";
import { addHold, HOLDS_KEY, parseHoldsRaw, removeHold, serializeHolds } from "@/demo/holdStore";

const listeners = new Set<() => void>();
/** undefined = 아직 안 읽음. */
let memory: string | null | undefined;
let storageBlocked = false;

function notify() {
  listeners.forEach((l) => l());
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== HOLDS_KEY) return;
  memory = e.newValue;
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function snapshot(): string | null {
  if (memory === undefined) {
    try {
      memory = window.localStorage.getItem(HOLDS_KEY);
    } catch {
      memory = null;
      storageBlocked = true;
    }
  }
  return memory;
}

function write(v: string | null) {
  memory = v;
  try {
    if (v === null) window.localStorage.removeItem(HOLDS_KEY);
    else window.localStorage.setItem(HOLDS_KEY, v);
  } catch {
    storageBlocked = true;
  }
  notify();
}

export interface HoldsApi {
  holds: Hold[];
  /** 저장돼 있던 가예약 모양이 틀려 모두 버렸으면 그 까닭. */
  dropped: string | null;
  blocked: boolean;
  add: (args: { service: string; date: LocalDate; start: string; nowMs: number; memo?: string }) => Hold;
  remove: (id: string) => void;
  reset: () => void;
}

export function useHolds(): HoldsApi {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const blocked = useSyncExternalStore(
    subscribe,
    () => {
      snapshot();
      return storageBlocked;
    },
    () => false,
  );
  const { engine } = mustDemo();
  // parseHoldsRaw는 예외를 던지지 않는다. 저장값이 깨져도 띠·화면이 멈추지 않고 비운다.
  const { holds, dropped } = useMemo(() => parseHoldsRaw(raw, engine), [raw, engine]);
  const add = useCallback(
    (args: { service: string; date: LocalDate; start: string; nowMs: number; memo?: string }) => {
      const cur = parseHoldsRaw(snapshot(), engine).holds;
      const r = addHold(cur, args);
      write(serializeHolds(r.holds));
      return r.hold;
    },
    [engine],
  );
  const remove = useCallback(
    (id: string) => {
      const next = removeHold(parseHoldsRaw(snapshot(), engine).holds, id);
      write(next.length === 0 ? null : serializeHolds(next));
    },
    [engine],
  );
  const reset = useCallback(() => write(null), []);
  return { holds, dropped, blocked, add, remove, reset };
}
