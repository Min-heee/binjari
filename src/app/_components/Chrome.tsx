"use client";

/**
 * 모든 화면 위의 띠와 머리(PRD F11). 띠는 스크롤해도 보인다 — 어느 화면을 캡처해도 가상 의원·합성 예약·기준 시각·[가정] 규칙이 함께 찍히게.
 * 이 브라우저의 가예약 수도 띠에 보인다(가예약은 이 기기에서만 보인다는 것을 늘 드러내려고).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { liveHolds } from "@/core/holds";
import { bandText } from "@/demo/call";
import { demo, demoNowMs, demoSource, mustDemo } from "@/demo/data";
import { FEED_MODE } from "@/demo/feed";
import { useClientReady } from "../_lib/useClientReady";
import { useHolds } from "../_lib/useHolds";

// short는 휴대폰 폭에서 쓰는 이름. 320px에서도 세 탭이 한 줄에 들어가게.
export const TABS = [
  { href: "/", label: "전화 받기", short: "전화" },
  { href: "/rules/", label: "규칙 보기", short: "규칙" },
  { href: "/eval/", label: "평가", short: "평가" },
];

/** 샘플의원 네 도구의 관계(PRD 1절). 접을 수 있게 둔다(통화 화면의 세로 자리를 아끼려고). */
export const TOOLS_LINE = [
  { name: "한창구", role: "글로 온 문의의 답장 초안" },
  { name: "다시봄", role: "병원이 먼저 거는 사후관리 연락" },
  { name: "같은각도", role: "경과 사진을 같은 조건으로" },
  { name: "빈자리", role: "전화로 온 예약 요청의 빈 시간", self: true },
];

export function isActiveTab(href: string, path: string): boolean {
  if (href === "/") return path === "/";
  return path.startsWith(href.replace(/\/$/, ""));
}

function HoldCount() {
  const { engine } = mustDemo();
  const { holds, blocked, dropped } = useHolds();
  const n = liveHolds(engine, holds, demoNowMs()).length;
  // 0건이면 띠 한 줄을 아낀다(휴대폰 첫 화면에 결과 첫 칩 줄이 들어오게). 띠 글자에 "가예약은 이 기기에서만"은 늘 있다.
  if (n === 0 && !blocked && !dropped) return null;
  return (
    <span className="band-holds">
      이 기기 가예약 {n}건
      {blocked && " · 저장이 막혀 새로 고치면 사라짐"}
      {dropped && " · 저장값이 틀려 비움"}
    </span>
  );
}

export function Chrome() {
  const path = usePathname() ?? "/";
  const ready = useClientReady();
  const d = ready ? demo() : null;
  const src = ready ? demoSource() : null;
  return (
    <>
      <div className="band" role="note" aria-label="시연 안내">
        <strong>{d === null ? "불러오는 중…" : d.ok ? bandText(d.engine, demoNowMs(), src?.clinicName ? { clinic: `가상 의원(${src.clinicName})`, source: src.sourceLabel ?? "" } : undefined) : FEED_MODE ? "가상 의원 · 바깥 예약 입력 · 규칙·입력 오류로 멈춤" : "가상 의원 · 합성 예약 · 규칙 오류로 멈춤"}</strong>
        {d?.ok && <HoldCount />}
      </div>
      <header className="top">
        <div className="top-row">
          <p className="brand">
            <span className="brand-name">빈자리</span>
            <small>전화 예약의 빈 시간 — 계산은 규칙이, 확정은 사람이</small>
          </p>
          <nav className="tabs" aria-label="화면">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} aria-current={isActiveTab(t.href, path) ? "page" : undefined} aria-label={t.label}>
                <span className="tab-long">{t.label}</span>
                <span className="tab-short" aria-hidden="true">
                  {t.short}
                </span>
              </Link>
            ))}
          </nav>
        </div>
        {FEED_MODE ? (
          <details className="tools">
            <summary>{src?.clinicName ? `${src.clinicName} · 빈자리` : "빈자리"}</summary>
            <p>다른 앱(한창구)에 품은 빈자리입니다. 이 화면은 품은 앱이 넘겨준 예약·기준 시각으로 돕니다.</p>
          </details>
        ) : (
          <details className="tools">
            <summary>샘플의원 네 도구</summary>
            <p>
              {TOOLS_LINE.map((t, i) => (
                <span key={t.name}>
                  {i > 0 && " · "}
                  {t.self ? (
                    <strong>
                      {t.name}({t.role})
                    </strong>
                  ) : (
                    `${t.name}(${t.role})`
                  )}
                </span>
              ))}
              . 도구끼리 연동은 없습니다.
            </p>
          </details>
        )}
      </header>
    </>
  );
}
