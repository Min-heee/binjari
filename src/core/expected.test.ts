import { describe, expect, it } from "vitest";
import { at, engine, repoFile, schedule } from "./__fixtures__/load";
import { findSlots } from "./slots";

/**
 * 별도 구현 대조(PRD 7절). data/expected-slots.json은 앱 코드를 쓰지 않는 파이썬 계산기(data/scripts/slots_expected.py)가
 * 볼트 json과 합성 예약만 다시 읽어 만든 것이다. 여기서는 엔진이 같은 기준 시각·안건에서 **모든 시작 후보**에 같은 판정
 * (빈 칸인지, 아니면 떨어진 까닭 집합)을 내는지 한 행씩 본다. 휴진일은 날짜당 한 행(휴진 / 공휴일 미확인).
 *
 * 한계: 같은 AI가 같은 문서를 해석했으므로 해석 실수(접수 마감 포함, 점심 맞닿기, 리드 올림)는 둘이 함께 틀릴 수 있다.
 * 기대값은 "AI가 계산, 사람 검수 전"이다.
 */

type Row = [string, string | null, string[]];
interface Expected {
  status: string;
  bases: Record<string, Record<string, Row[]>>;
}

const X = JSON.parse(repoFile("data/expected-slots.json")) as Expected;
const E = engine();
const S = schedule(E);

function engineRows(service: string, base: string): Row[] {
  const r = findSlots(E, { service, nowMs: at(base), schedule: S, holds: [] });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.days.flatMap((d): Row[] =>
    d.candidates.length === 0 ? [[d.date, null, [d.kind]]] : d.candidates.map((c): Row => [c.date, c.start, [...c.reasons].sort()]),
  );
}

describe("별도 구현(파이썬) 대조", () => {
  it("기대값은 검수 전이라고 적혀 있다", () => {
    expect(X.status).toBe("AI가 계산, 사람 검수 전");
    expect(Object.keys(X.bases)).toHaveLength(5);
  });

  for (const [base, services] of Object.entries(X.bases)) {
    for (const [service, rows] of Object.entries(services)) {
      it(`${base} ${service}: 후보 ${rows.length}행이 판정·까닭까지 같다`, () => {
        const mine = engineRows(service, base);
        const key = (r: Row) => `${r[0]} ${r[1] ?? "-"}`;
        const want = new Map(rows.map((r) => [key(r), r[2].join(",")]));
        const got = new Map(mine.map((r) => [key(r), r[2].join(",")]));
        expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
        const diff = [...want].filter(([k, v]) => got.get(k) !== v).map(([k, v]) => `${k}: 대조 [${v}] / 엔진 [${got.get(k)}]`);
        expect(diff).toEqual([]);
      });
    }
  }

  it("합계: 빈 칸 수가 같다", () => {
    let want = 0;
    let got = 0;
    for (const [base, services] of Object.entries(X.bases)) {
      for (const [service, rows] of Object.entries(services)) {
        want += rows.filter((r) => r[1] !== null && r[2].length === 0).length;
        got += engineRows(service, base).filter((r) => r[1] !== null && r[2].length === 0).length;
      }
    }
    expect(got).toBe(want);
    expect(want).toBe(779);
  });
});
