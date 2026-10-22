"use client";

import { useSyncExternalStore } from "react";
import { currentFeedObject, FEED_EVENT, FEED_MODE, FEED_REFRESH_EVENT, FEED_REFRESH_MS, FEED_WAIT_MS, requestFeed } from "@/demo/feed";

/** "waiting": 아직 못 받음 · "gave-up": 기다림이 끝남(오류 화면) · 숫자: 받은 차례(새로 받을 때마다 다시 그린다). */
type FeedState = "waiting" | "gave-up" | number;

let state: FeedState = "waiting";
let received = 0;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

const emit = () => listeners.forEach((l) => l());

/**
 * feed.js를 화면이 뜬 뒤에 읽는다(하이드레이션을 막지 않게). 처음 값이 FEED_WAIT_MS 안에 안 오면 오류 화면을 보이고,
 * 늦게라도 오면 그때 다시 그린다. 열어 둔 동안은 FEED_REFRESH_MS마다, 화면이 다시 보일 때, 품은 앱이 FEED_REFRESH_EVENT를
 * 보낼 때 다시 읽는다 — 페이지를 새로 고치지 않으니 통화 중 고른 안건·칸은 그대로다.
 */
function start(): () => void {
  const onFeed = () => {
    received += 1;
    state = received;
    emit();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") requestFeed();
  };
  window.addEventListener(FEED_EVENT, onFeed);
  window.addEventListener(FEED_REFRESH_EVENT, requestFeed);
  document.addEventListener("visibilitychange", onVisible);
  const wait = window.setTimeout(() => {
    if (state === "waiting") {
      state = "gave-up";
      emit();
    }
  }, FEED_WAIT_MS);
  const tick = window.setInterval(requestFeed, FEED_REFRESH_MS);
  if (currentFeedObject() !== undefined) onFeed();
  else requestFeed();
  return () => {
    window.removeEventListener(FEED_EVENT, onFeed);
    window.removeEventListener(FEED_REFRESH_EVENT, requestFeed);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearTimeout(wait);
    window.clearInterval(tick);
  };
}

function subscribe(listener: () => void): () => void {
  if (!FEED_MODE) return () => {};
  listeners.add(listener);
  stop ??= start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = null;
    }
  };
}

const snapshot = (): FeedState | "static" => (FEED_MODE ? state : "static");
const serverSnapshot = (): FeedState | "static" => (FEED_MODE ? "waiting" : "static");

/**
 * 바깥 입력(feed.js) 빌드에서는 서버(빌드)·하이드레이션 때와 첫 값을 기다리는 동안 false, 그 뒤 true.
 * 새 값을 받을 때마다 이 훅을 쓰는 화면이 다시 그려진다. 기본 빌드에서는 늘 true라 지금과 똑같이 서버에서 다 그린다.
 */
export function useClientReady(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot) !== "waiting";
}
