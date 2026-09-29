/**
 * 규칙 보기(읽기 전용). 빈 시간 계산에 쓰는 값을 엔진이 읽은 그대로 보이고, 아래에 볼트 문서 원문을 문서째 싣는다.
 * 값을 바꾸는 화면은 없다 — 규칙은 볼트 문서(vault/booking-slots.md 등)를 고쳐서만 바뀐다(PRD F2).
 */

import { demo, vaultSources } from "@/demo/data";
import { capacityRows, docRows, holidayRows, hoursRows, intakeRows, otherRows, serviceRows } from "@/demo/rulesView";
import { ErrorPanel } from "./ErrorPanel";

function Kv({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RulesScreen() {
  const d = demo();
  const docs = docRows(vaultSources());
  if (!d.ok) return <ErrorPanel errors={d.errors} />;
  const { engine } = d;
  const b01 = docs.find((x) => x.id === "B01");
  return (
    <div className="rules">
      <h1>규칙 보기</h1>
      <p>
        빈 시간은 아래 값으로만 계산합니다. 값은 볼트 문서의 json에서 읽고, 문서가 깨지거나 값이 빠지면 추측하지 않고 멈춥니다. 이 화면에서는 값을 바꿀 수 없습니다.
      </p>
      {b01 && (
        <p className="note warn">
          <strong>예약 칸 규칙(B01)은 [가정] 문서입니다.</strong> AI(Claude Code)가 쓴 초안이고 병원 확인 전입니다(status: {b01.status}, approvedBy: {b01.approvedBy || "없음"}). 진료시간·점심·예약금 같은 사실은 승인 문서(V02·V03·V04)에서 읽습니다.
        </p>
      )}

      <section className="card">
        <h2>문서</h2>
        <div className="scroll-x">
          <table className="metrics">
            <thead>
              <tr>
                <th>문서</th>
                <th>상태</th>
                <th>이 도구가 쓰는 곳</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((x) => (
                <tr key={x.id}>
                  <td>
                    <strong>{x.id}</strong> {x.title}
                    <br />
                    <span className="small muted">{x.path}</span>
                  </td>
                  <td>
                    <span className={`badge ${x.status === "approved" ? "green" : "orange"}`}>{x.status === "approved" ? "승인" : "초안"}</span>
                    {x.assumption && <span className="badge orange">[가정]</span>}
                  </td>
                  <td className="small">{x.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>진료시간과 휴진(V02·B02)</h2>
        <Kv rows={hoursRows(engine)} />
        <details className="fold">
          <summary>공휴일 {engine.calendar.holidays.length}일 · 확인 기간 {engine.calendar.holidayCoverage.from}~{engine.calendar.holidayCoverage.to}</summary>
          <p className="small">{holidayRows(engine).join(" · ")}</p>
          <p className="small muted">확인 기간 밖의 날짜는 칸을 내지 않고 &ldquo;공휴일 미확인 — 계산하지 않음&rdquo;으로 표시합니다.</p>
        </details>
      </section>

      <section className="card">
        <h2>안건별 시간과 사람·방(B01)</h2>
        <div className="scroll-x">
          <table className="metrics">
            <thead>
              <tr>
                <th>안건</th>
                <th>시간</th>
                <th>쓰는 사람·방(시작부터 분)</th>
                <th>시작</th>
                <th>점심</th>
                <th>예약금</th>
              </tr>
            </thead>
            <tbody>
              {serviceRows(engine).map((s) => (
                <tr key={s.key}>
                  <td>
                    {s.label}
                    {!s.bookable && <span className="small muted"> (버튼으로 잡지 않음)</span>}
                  </td>
                  <td className="num">{s.minutes}</td>
                  <td className="small">{s.phases}</td>
                  <td className="small">{s.starts}</td>
                  <td className="small">{s.lunch}</td>
                  <td className="small">{s.deposit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>사람·방 수</h3>
        <ul className="small">
          {capacityRows(engine).map((c) => (
            <li key={c.when}>
              <strong>{c.when}</strong>: {c.values}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>그 밖의 값(B01)</h2>
        <Kv rows={otherRows(engine)} />
      </section>

      <section className="card">
        <h2>버튼 · 질문 · 대답(B01)</h2>
        <div className="scroll-x">
          <table className="metrics">
            <thead>
              <tr>
                <th>버튼</th>
                <th>질문</th>
                <th>대답</th>
                <th>찾는 안건</th>
                <th>안내</th>
              </tr>
            </thead>
            <tbody>
              {intakeRows(engine).map((r) => (
                <tr key={`${r.path}-${r.answer}`}>
                  <td>{r.path}</td>
                  <td>{r.question}</td>
                  <td>{r.answer}</td>
                  <td>{r.service}</td>
                  <td className="small">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">범위 한 줄: {engine.rules.scopeLine}</p>
      </section>

      <section className="card">
        <h2>문장 틀(B01, AI가 쓴 [가정] 문장)</h2>
        <p className="small muted">칸({"{{…}}"})만 채웁니다. 볼트를 읽을 때 광고 표현 검사(V15)를 통과해야 하고, 칸을 채운 뒤에도 한 번 더 봅니다.</p>
        <details className="fold">
          <summary>문장 틀 {Object.keys(engine.rules.templates).length}개</summary>
          <dl className="kv templates">
            {Object.entries(engine.rules.templates).map(([k, t]) => (
              <div key={k} className="kv-row">
                <dt>
                  <code>{k}</code>
                </dt>
                <dd>{t}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <section className="card">
        <h2>문서 원문</h2>
        <p className="small muted">가상 의원의 예시 문서입니다. 실제 의료 지침이 아닙니다.</p>
        {docs.map((x) => (
          <details key={x.id} className="fold">
            <summary>
              {x.id} {x.title}
            </summary>
            <pre className="raw">{x.raw}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
