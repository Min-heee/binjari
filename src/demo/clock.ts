/**
 * 시연 모드의 시계(PRD 3절·F9). 기준 시각은 **이 파일의 DEMO_NOW 하나**다.
 *
 * 왜 고정하나: 합성 기존 예약은 2026-09-21(월)부터 만들었다. 실제 시계로 빈 시간을 찾으면 여는 날마다 결과가 달라지고,
 * "같은 입력 → 같은 결과"를 시험할 수 없다. 한창구와 같은 9/21(월) 10:00 — 그 주 목~일(9/24~27)이 추석 연휴와 일요일이라
 * 2주 안에 휴진 건너뛰기가 보인다.
 *
 * 기준 시각을 바꿔 볼 수 있는 범위(F9)는 합성 예약이 덮는 9/21 10:00 ~ 10/6 19:00이다(일반 예약 10/19, 수술 11/2까지 —
 * 가장 늦은 기준 시각 + 찾는 기간 14일·28일을 덮는다).
 */

import { parseInstant, type LocalDate, kstDateOf } from "@/core/calendar";

export const DEMO_NOW = "2026-09-21T10:00:00+09:00";
export const DEMO_NOW_MS = parseInstant(DEMO_NOW);
export const DEMO_TODAY: LocalDate = kstDateOf(DEMO_NOW_MS);

export const DEMO_RANGE = {
  from: parseInstant("2026-09-21T10:00:00+09:00"),
  to: parseInstant("2026-10-06T19:00:00+09:00"),
} as const;

/** 기준 시각 바꿔 보기(F9)가 받는 값인가. 범위 밖이면 막는다(합성 예약이 덮지 않는 날의 빈 시간은 믿을 수 없다). */
export function isDemoNowAllowed(ms: number): boolean {
  return ms >= DEMO_RANGE.from && ms <= DEMO_RANGE.to;
}
