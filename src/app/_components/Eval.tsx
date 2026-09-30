/**
 * 평가(PRD 7절, F10). 서버 컴포넌트라 빌드 때 한 번 계산한다(기준 시각 10분 간격 규칙 위반 검사에 십여 초).
 * 맨 위에 편향과 아직 하지 않은 것을 먼저 적는다 — 숫자만 보고 "검증 끝"으로 읽히지 않게.
 */

import { formatShort } from "@/core/calendar";
import { REASON_LABEL } from "@/core/slots";
import { demo } from "@/demo/data";
import { buildReport, reasonText, sweepRangeText } from "@/demo/evaluate";
import { ErrorPanel } from "./ErrorPanel";

/** 평가 화면의 규칙 위반 검사 간격(분). PRD 7절 "10분마다". */
export const EVAL_STEP_MINUTES = 10;

const ratio = (a: number, b: number) => `${a.toLocaleString("ko-KR")} / ${b.toLocaleString("ko-KR")}`;

export function EvalScreen({ stepMinutes = EVAL_STEP_MINUTES }: { stepMinutes?: number }) {
  const d = demo();
  if (!d.ok) return <ErrorPanel errors={d.errors} />;
  const { engine, schedule } = d;
  const r = buildReport(engine, schedule, stepMinutes);
  const boundaryPass = r.boundaries.filter((b) => b.pass).length + r.dayCases.filter((c) => c.pass).length;
  const boundaryTotal = r.boundaries.length + r.dayCases.length;
  const violations = r.sweep.rules.reduce((a, x) => a + x.violations, 0);
  return (
    <div className="eval">
      <h1>평가</h1>
      <div className="note warn">
        <p>
          <strong>모두 합성 데이터 기준입니다.</strong> 규칙 문서(B01)·합성 예약·엔진·검사기·기대값을 같은 도구(Claude Code)로 만들었고, <strong>기대값(경계 사례 표·규칙 해석)은 AI 작성·사람 검수 전</strong>입니다. 두 구현이 같은 문서를 같은 쪽으로 잘못 읽은 해석 실수(접수 마감 포함, 점심 맞닿음)는 여기 숫자로 잡히지 않습니다. 못 미쳐도 그대로 싣습니다.
        </p>
      </div>

      <section className="card">
        <h2>한눈에</h2>
        <table className="metrics">
          <tbody>
            <tr>
              <th>규칙 위반(따로 짠 검사기)</th>
              <td className="num">{violations}건</td>
              <td className="small">
                앱이 낸 칸 {r.sweep.slots.toLocaleString("ko-KR")}개 · 기준 시각 {r.sweep.times.toLocaleString("ko-KR")}개({sweepRangeText()}, {r.sweep.stepMinutes}분 간격) × 안건 6
              </td>
            </tr>
            <tr>
              <th>심은 경계 사례</th>
              <td className="num">{ratio(boundaryPass, boundaryTotal)}</td>
              <td className="small">의도대로 판정된 사례 / 사례(판정은 앱 엔진)</td>
            </tr>
            <tr>
              <th>결정성</th>
              <td className="num">{r.determinism.changed}건</td>
              <td className="small">결과가 달라진 쌍 / {r.determinism.total}쌍(기준 시각 5 × 안건 6 × 변형 3)</td>
            </tr>
            <tr>
              <th>별도 구현 대조</th>
              <td className="num">3,580 / 3,580행</td>
              <td className="small">
                앱 코드를 쓰지 않는 파이썬 계산기(data/scripts/slots_expected.py)가 기준 시각 5 × 안건 6의 모든 시작 후보를 판정한 행(휴진일은 날짜당 1행)과 판정·떨어진 까닭까지 같은 행. 빈 칸 779개 중 잘못 냄 0 · 빠뜨림 0. 화면이 아니라 시험(src/core/expected.test.ts)이 npm run verify마다 다시 확인합니다. 같은 AI가 같은 문서를 해석했으므로 해석 실수(접수 마감 포함, 점심 맞닿기, 리드 올림)는 못 잡습니다.
              </td>
            </tr>
            <tr>
              <th>사람 손 검수</th>
              <td className="num">미실시</td>
              <td className="small">사람이 달력과 예약표로 확인한 행 0 / 20(사람 몫, 목표가 아님)</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>규칙 위반 — 규칙별</h2>
        <p className="small muted">
          기준 시각을 {sweepRangeText()}에서 {r.sweep.stepMinutes}분마다 바꿔 가며, 앱이 낸 모든 칸을 엔진의 판정 함수를 쓰지 않고 따로 짠 검사기(src/demo/violations.ts)로 봅니다. 가예약 {r.holds.length}건(
          {r.holds.map((h) => `${engine.rules.services[h.service].label} ${formatShort(h.date)} ${h.start}`).join(", ")}, 9/21 10:00에 만듦)을 넣었습니다. 분모가 0이면 위반 0은 의미가 없습니다.
        </p>
        <div className="scroll-x">
          <table className="metrics">
            <thead>
              <tr>
                <th>규칙</th>
                <th>어긴 칸 / 검사한 칸</th>
              </tr>
            </thead>
            <tbody>
              {r.sweep.rules.map((x) => (
                <tr key={x.key}>
                  <td>{x.label}</td>
                  <td className="num">{ratio(x.violations, x.checked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.sweep.examples.length > 0 && (
          <ul className="small">
            {r.sweep.examples.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>심은 경계 사례(PRD 7절)</h2>
        <div className="scroll-x">
          <table className="metrics">
            <thead>
              <tr>
                <th>칸</th>
                <th>안건</th>
                <th>기대</th>
                <th>앱 판정</th>
                <th>결과</th>
              </tr>
            </thead>
            <tbody>
              {r.boundaries.map((b) => (
                <tr key={`${b.service}-${b.date}-${b.start}-${b.base}`}>
                  <td>
                    {formatShort(b.date)} {b.start}
                    <br />
                    <span className="small muted">
                      {b.label} · 기준 {b.base.slice(5, 16).replace("T", " ")}
                    </span>
                  </td>
                  <td className="small">{engine.rules.services[b.service].label}</td>
                  <td className="small">{b.expect === null ? "가능" : `불가(${REASON_LABEL[b.expect]})`}</td>
                  <td className="small">{reasonText(b.reasons)}</td>
                  <td>
                    <span className={`badge ${b.pass ? "green" : "red"}`}>{b.pass ? "통과" : "실패"}</span>
                  </td>
                </tr>
              ))}
              {r.dayCases.map((c) => (
                <tr key={c.label}>
                  <td colSpan={2} className="small">
                    {c.label}
                  </td>
                  <td className="small">{c.expect}</td>
                  <td className="small">{c.actual}</td>
                  <td>
                    <span className={`badge ${c.pass ? "green" : "red"}`}>{c.pass ? "통과" : "실패"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>통화 중 조작 수(설계상 값)</h2>
        <p className="small muted">버튼을 누르기 시작해 첫 빈 시간이 보일 때까지의 누름 수입니다. 화면 상태 함수(callReducer)로 모든 길을 실제로 눌러 센 값이고, 사람이 전화를 받으며 잰 값이 아닙니다.</p>
        <table className="metrics">
          <thead>
            <tr>
              <th>길</th>
              <th>찾는 안건</th>
              <th>누름</th>
            </tr>
          </thead>
          <tbody>
            {r.presses.map((p) => (
              <tr key={p.path}>
                <td>{p.path}</td>
                <td className="small">
                  {p.service}
                  {p.redirect && " (첫 상담으로 바뀜)"}
                </td>
                <td className="num">{p.presses}번</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">수술 크기를 반나절로 바꾸면 +1, 거르개 하나 +1, 칸을 눌러 문장을 보면 +1, 가예약 +1.</p>
      </section>

      <section className="card">
        <h2>기준 시각 9/21(월) 10:00의 첫 빈 시간</h2>
        <table className="metrics">
          <tbody>
            {r.firstSlots.map((f) => (
              <tr key={f.service}>
                <th>{f.label}</th>
                <td className="small">{f.first.join(" · ")}</td>
                <td className="num">{f.count}칸</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>재지 않은 것</h2>
        <ul className="small">
          <li>변이 검사(규칙을 일부러 틀리게 바꾸기)는 저장소 밖 스크립트로 2026-09-30에 한 번 돌렸습니다: 42개 중 42개를 시험이 잡음(시간대 결함 하나는 UTC 실행에서만 잡힘). 빌드마다 다시 돌지는 않습니다.</li>
          <li>375×667에서 첫 칩 줄이 스크롤 없이 보이는 것은 상담 → 예, 처음(657px)뿐입니다. 재시술·주사·수술은 안내 줄과 하위 칩 때문에 첫 칩 줄이 화면 아래(767~856px)로 내려갑니다(헤드리스 크롬으로 잼).</li>
          <li>도입 뒤 볼 것: 통화 한 건 시간이 줄었는지, 잘못 안내해 다시 건 전화 수, 가예약이 실제 예약으로 이어진 비율.</li>
        </ul>
      </section>
    </div>
  );
}
