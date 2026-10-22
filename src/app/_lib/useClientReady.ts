"use client";

import { useSyncExternalStore } from "react";
import { FEED_EVENT, FEED_MODE, FEED_WAIT_MS } from "@/demo/feed";

let gaveUp = false;

const feedArrived = () => (globalThis as { __BINJARI_FEED__?: unknown }).__BINJARI_FEED__ !== undefined;

function subscribe(onChange: () => void): () => void {
  if (!FEED_MODE) return () => {};
  window.addEventListener(FEED_EVENT, onChange);
  // feed.js를 못 읽었으면(404 등) 기다리기만 하지 않고 오류 화면으로 넘어간다(F2: 조용히 기본값으로 가지 않음).
  const timer = window.setTimeout(() => {
    gaveUp = true;
    onChange();
  }, FEED_WAIT_MS);
  return () => {
    window.removeEventListener(FEED_EVENT, onChange);
    window.clearTimeout(timer);
  };
}

/**
 * 바깥 입력(feed.js) 빌드에서는 서버(빌드)·하이드레이션 때 false, 입력이 도착하거나 기다림이 끝나면 true.
 * 스크립트 실행 순서(beforeInteractive)에 기대지 않고 입력을 직접 기다린다 — 미리 그린 HTML과 브라우저 값이 달라도 하이드레이션이 깨지지 않게.
 * 기본 빌드에서는 늘 true라 지금과 똑같이 서버에서 다 그린다.
 */
export function useClientReady(): boolean {
  return useSyncExternalStore(subscribe, () => !FEED_MODE || feedArrived() || gaveUp, () => !FEED_MODE);
}
