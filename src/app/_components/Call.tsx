"use client";

/**
 * 통화 중 한 화면(PRD 3절 30초 시연, F1·F4~F7·F11·F12). 계산은 모두 src/demo/call.ts(callReducer·callView)가 하고, 여기서는 그리기만 한다.
 *
 * 한 손 조작: 큰 안건 버튼 셋 → (시술이면 하위 칩) → 확인 질문 대답. 상담·재시술은 2번, 시술은 3번 누르면 빈 시간이 뜬다.
 * 칸을 누르면 아래에서 시트가 올라와 읽어 줄 문장·확정 문자 틀 복사·가예약(이 브라우저에만)을 한곳에서 한다.
 * CallLayout은 뷰 모델만 받는 그리기 전용 컴포넌트라 시험이 상태를 바꿔 가며 서버 렌더로 찍어 볼 수 있다(screens.test.tsx).
 */

import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from "react";
import { formatShort, type LocalDate } from "@/core/calendar";
import type { Composed } from "@/core/message";
import { callReducer, callView, holdRows, INITIAL_CALL, type CallAction, type CallState, type CallView, type HoldRow, type LineView, type SheetView } from "@/demo/call";
import { demo, demoNowMs, mustDemo } from "@/demo/data";
import { useClientReady } from "../_lib/useClientReady";
import { copyText } from "../_lib/copy";
import { useHolds } from "../_lib/useHolds";
import { ErrorPanel } from "./ErrorPanel";

export function CallScreen({ initial = INITIAL_CALL }: { initial?: CallState }) {
  const ready = useClientReady();
  if (!ready) return <p className="muted">불러오는 중…</p>;
  const d = demo();
  if (!d.ok) return <ErrorPanel errors={d.errors} />;
  return <CallLive initial={initial} />;
}

function CallLive({ initial }: { initial: CallState }) {
  const { engine, schedule } = mustDemo();
  const store = useHolds();
  const [state, dispatch] = useReducer(callReducer, initial);
  const [copied, setCopied] = useState<string | null>(null);
  const nowMs = demoNowMs();
  const input = useMemo(() => ({ engine, schedule, holds: store.holds, nowMs }), [engine, schedule, store.holds, nowMs]);
  const view = useMemo(() => callView(input, state), [input, state]);
  const rows = useMemo(() => holdRows(engine, store.holds, nowMs), [engine, store.holds, nowMs]);

  const copy = (key: string, text: string) => {
    void copyText(text).then((ok) => setCopied(ok ? key : `fail:${key}`));
  };

  return (
    <CallLayout
      view={view}
      scopeLine={engine.rules.scopeLine}
      pressHelp={pressHelp(engine.rules.intake)}
      rows={rows}
      dispatch={(a) => {
        setCopied(null);
        dispatch(a);
      }}
      copied={copied}
      onCopy={copy}
      onHold={(memo) => {
        const r = view.result;
        if (!r || !state.selected) return;
        store.add({ service: r.service.key, date: state.selected.date, start: state.selected.start, nowMs, memo });
        setCopied(null);
      }}
      onUndo={(id) => store.remove(id)}
      onReset={() => store.reset()}
      notice={store.dropped ? `저장된 가예약 모양이 틀려 모두 비웠습니다(${store.dropped}).` : store.blocked ? "이 브라우저는 저장이 막혀 있어, 가예약은 새로 고치면 사라집니다." : null}
    />
  );
}

export interface CallLayoutProps {
  view: CallView;
  scopeLine: string;
  rows: HoldRow[];
  dispatch: Dispatch<CallAction>;
  /** 방금 복사한 것의 키(실패는 "fail:키"). */
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  onHold: (memo: string) => void;
  onUndo: (holdId: string) => void;
  onReset: () => void;
  notice: string | null;
  /** 안건별로 몇 번 누르면 빈 시간이 뜨는지. 규칙(B01 intake)에서 만든다. */
  pressHelp?: string;
}

/** 바로 질문이 나오는 안건은 2번, 하위 선택이 있는 안건은 3번 누른다. */
export function pressHelp(intake: { label: string; subs?: unknown[] }[]): string {
  const two = intake.filter((b) => !b.subs).map((b) => b.label);
  const three = intake.filter((b) => b.subs).map((b) => b.label);
  return [two.length > 0 ? `${two.join("·")} 2번` : "", three.length > 0 ? `${three.join("·")} 3번` : ""].filter(Boolean).join(", ");
}

export function CallLayout(p: CallLayoutProps) {
  const { view, dispatch } = p;
  const chosen = view.buttons.some((b) => b.pressed);
  return (
    <div className="call">
      <section aria-label="안건 고르기" className="intake">
        <div className={`big-buttons${chosen ? " chosen" : ""}`} role="group" aria-label="안건 버튼">
          {view.buttons.map((b) => (
            <button key={b.key} type="button" className="big-btn" aria-pressed={b.pressed} onClick={() => dispatch({ type: "button", key: b.key })}>
              <span className="big-label">{b.label}</span>
              {b.hint && <small className="big-hint">{b.hint}</small>}
            </button>
          ))}
        </div>
        <p className="scope">{p.scopeLine}</p>
        {!chosen && (
          <p className="first-help">
            전화가 오면 고객이 원하는 것 하나를 누르세요. 질문 하나에 답하면 그 안건에 맞는 빈 시간이 날짜별로 뜹니다({p.pressHelp ?? "상담·재시술 2번, 시술 3번"}).
          </p>
        )}

        {view.subs && (
          <div className="chips" role="group" aria-label="시술 고르기">
            {view.subs.map((s) => (
              <button key={s.key} type="button" className="chip sub" aria-pressed={s.pressed} onClick={() => dispatch({ type: "sub", key: s.key })}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        {view.question && (
          <div className="question" role="group" aria-labelledby="q-text">
            <p id="q-text" className="q-text">
              {view.question.text}
            </p>
            <div className="answers">
              {view.question.answers.map((a) => (
                <button key={a.key} type="button" className="answer" aria-pressed={a.pressed} onClick={() => dispatch({ type: "answer", key: a.key })}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {view.sizes && (
          <div className="chips sizes" role="group" aria-label="수술 크기">
            <span className="chips-label">수술 크기</span>
            {view.sizes.map((z) => (
              <button key={z.key} type="button" className="chip" aria-pressed={z.pressed} onClick={() => dispatch({ type: "size", key: z.key })}>
                {z.label}
              </button>
            ))}
          </div>
        )}

        {view.move && (
          <label className="move">
            옮길 회차의 예정일
            <select value={view.move.value ?? ""} onChange={(e) => dispatch({ type: "moveDue", date: e.target.value === "" ? null : (e.target.value as LocalDate) })}>
              <option value="">예정일을 고르세요</option>
              {view.move.options.map((o) => (
                <option key={o.date} value={o.date}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {p.notice && <p className="note warn">{p.notice}</p>}
      {view.errors.length > 0 && <ErrorPanel errors={view.errors} />}
      {view.result && <Results view={view} dispatch={dispatch} copied={p.copied} onCopy={p.onCopy} />}
      {p.rows.length > 0 && <HoldsPanel rows={p.rows} copied={p.copied} onCopy={p.onCopy} onUndo={p.onUndo} onReset={p.onReset} />}
      {view.sheet && (
        <Sheet
          key={`${view.sheet.date}-${view.sheet.start}`}
          sheet={view.sheet}
          copied={p.copied}
          onCopy={p.onCopy}
          onHold={p.onHold}
          onUndo={p.onUndo}
          onClose={() => dispatch({ type: "close" })}
        />
      )}
    </div>
  );
}

function CopyButton({ id, text, label, copied, onCopy, primary = false }: { id: string; text: string; label: string; copied: string | null; onCopy: (key: string, text: string) => void; primary?: boolean }) {
  return (
    <span className="copy">
      <button type="button" className={primary ? "primary" : undefined} onClick={() => onCopy(id, text)}>
        {label}
      </button>
      <span className="copy-status" aria-live="polite">
        {copied === id ? "복사했습니다" : copied === `fail:${id}` ? "복사가 막혔습니다 — 글을 길게 눌러 복사" : ""}
      </span>
    </span>
  );
}

function ComposedText({ c, className = "readout" }: { c: Composed; className?: string }) {
  if (!c.ok) return <p className="note warn">문장 틀을 채우지 못했습니다(예약 프로그램 문구를 쓰세요): {c.errors.join(" / ")}</p>;
  return (
    <div className={className}>
      {c.lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      {c.ad.level !== "clean" && <p className="note warn">광고 표현 주의: {c.ad.hits.map((h) => h.matchedText).join(", ")}</p>}
    </div>
  );
}

function Results({ view, dispatch, copied, onCopy }: { view: CallView; dispatch: Dispatch<CallAction>; copied: string | null; onCopy: (key: string, text: string) => void }) {
  const r = view.result!;
  return (
    <section className="results" aria-labelledby="results-h">
      <h2 id="results-h" className="result-head">
        <span>{r.service.label}</span> <span className="badge blue">{r.service.minutes >= 240 ? `${r.service.minutes / 60}시간` : `${r.service.minutes}분`}</span>{" "}
        <span className="range">{r.rangeText}</span>
      </h2>
      {r.redirect && (
        <p className="note warn">
          <strong>{r.redirect}</strong> — 첫 상담 빈 시간을 보여 드립니다.
        </p>
      )}
      {/* 대답에 붙은 경고(재시술의 집도 의료진 일정 등)는 목록 아래가 아니라 여기 — 칸을 말하기 전에 보여야 한다. */}
      {r.warnings.map((w) => (
        <p key={w} className="note warn">
          {w}
        </p>
      ))}

      <div className="filters" aria-label="거르개">
        <div className="filter-row" role="group" aria-label={r.bands.length > 0 ? "시간대" : "날짜로 이동"}>
          {r.bands.map((b) => (
            <button key={b.key} type="button" className="chip" aria-pressed={b.pressed} onClick={() => dispatch({ type: "toggleBand", band: b.key })}>
              {b.label}
            </button>
          ))}
          <label className="jump">
            <span className="sr-only">날짜로 이동</span>
            <select value={r.jump.value ?? ""} onChange={(e) => dispatch({ type: "jump", date: e.target.value === "" ? null : (e.target.value as LocalDate) })}>
              <option value="">날짜로 이동</option>
              {r.jump.options.map((o) => (
                <option key={o.date} value={o.date}>
                  {o.closed ? o.label : `${o.label}부터`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="filter-row" role="group" aria-label="요일">
          {r.dows.map((d) => (
            <button key={d.key} type="button" className="chip dow" aria-pressed={d.pressed} onClick={() => dispatch({ type: "toggleDow", dow: d.key })}>
              {d.label}
            </button>
          ))}
          {r.filtered && (
            <button type="button" className="link" onClick={() => dispatch({ type: "clearFilter" })}>
              거르개 풀기
            </button>
          )}
        </div>
      </div>

      <p className="count">
        <strong>빈 시간 {r.count}칸</strong>
        {r.filtered && <span className="muted"> (거르기 전 {r.totalCount}칸)</span>}
        {r.earliestText && <span className="muted"> · {r.earliestText}</span>}
      </p>
      {r.emptyText && <p className="note warn">{r.emptyText}</p>}
      {r.windowNote && <p className="note warn">{r.windowNote}</p>}

      {r.readout && (
        <>
          {/* 제안 칸은 접지 않고 한 줄로 늘 보인다 — 긴 문장만 접어 첫 칩 줄이 한 화면에 들게(F11). */}
          <p className="suggest-line">
            <strong>먼저 말할 시간</strong> {r.suggestions.map((s) => `${formatShort(s.date)} ${s.start}`).join(" · ")}
          </p>
          <details className="fold readout-fold">
            <summary>고객에게 읽어 줄 문장 펼치기</summary>
            <ComposedText c={r.readout} />
            {r.accountNote && <p className="row"><span className="badge orange">{r.accountNote}</span></p>}
            {r.readout.ok && <CopyButton id="readout-suggest" text={r.readout.text} label="문장 복사" copied={copied} onCopy={onCopy} />}
            <p className="small muted">
              비어 있는 시간 안내입니다. 확정이 아닙니다 — {r.deposit ? "예약금 입금을 확인하고 " : ""}확정 연락을 보내야 확정됩니다. 칸을 누르면 그 칸 하나로 문장을 만들고 가예약할 수 있습니다.
            </p>
          </details>
        </>
      )}

      <ol className="days">
        {r.lines.map((l) => (
          <Line key={l.key} line={l} serviceLabel={r.service.label} dispatch={dispatch} copied={copied} onCopy={onCopy} />
        ))}
      </ol>
      {r.more && (
        <button type="button" className="more" onClick={() => dispatch({ type: "more", days: r.more!.days })}>
          {r.more.days}일 더 보기
        </button>
      )}
      {r.notes.length > 0 && (
        <ul className="svc-notes small">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Chip = { kind: "free"; key: string; slot: LineView["slots"][number] } | { kind: "held"; key: string; held: LineView["held"][number] };

function chipsOf(line: LineView): Chip[] {
  const chips: Chip[] = [
    ...line.slots.map((slot) => ({ kind: "free" as const, key: `${slot.date} ${slot.start}`, slot })),
    ...line.held.map((held) => ({ kind: "held" as const, key: `${held.date} ${held.start}`, held })),
  ];
  return chips.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const HOLD_STATE_LABEL = { alive: "가예약", expiring: "곧 풀림", "not-yet": "아직 없음", expired: "풀림" } as const;

function Line({ line, serviceLabel, dispatch, copied, onCopy }: { line: LineView; serviceLabel: string; dispatch: Dispatch<CallAction>; copied: string | null; onCopy: (key: string, text: string) => void }) {
  if (line.kind !== "slots" && line.held.length === 0) {
    const say = line.say;
    return (
      <li className={`day off ${line.kind}`}>
        {say ? (
          <details>
            <summary className="off-text">{line.text}</summary>
            <ComposedText c={say} />
            {say.ok && <CopyButton id={`closed-${line.key}`} text={say.text} label="문장 복사" copied={copied} onCopy={onCopy} />}
          </details>
        ) : (
          <span className="off-text">{line.text}</span>
        )}
      </li>
    );
  }
  return (
    <li className={`day ${line.kind === "slots" ? "slots" : `off ${line.kind}`}`}>
      <div className="day-head">
        <strong className="day-date">{line.text}</strong>
        {line.rel && <span className="badge blue">{line.rel}</span>}
        {line.tags.map((t) => (
          <span key={t} className={`badge ${t.includes("입금") || t.includes("취소") ? "orange" : "gray"}`}>
            {t}
          </span>
        ))}
      </div>
      <div className="slot-row">
        {/* 빈 칸과 이 기기 가예약 칸을 시각 순서대로 섞어 그린다(가예약 칸이 줄 끝으로 밀리지 않게). */}
        {chipsOf(line).map((c) =>
          c.kind === "free" ? (
            <button key={`f-${c.slot.date}-${c.slot.start}`} type="button" className="slot" aria-label={`${line.text} ${c.slot.start} ${serviceLabel} 빈 시간`} onClick={() => dispatch({ type: "select", date: c.slot.date, start: c.slot.start })}>
              {c.slot.start}
            </button>
          ) : (
            <button
              key={c.held.holdId}
              type="button"
              className={`slot held${c.held.state === "expiring" ? " expiring" : ""}`}
              aria-label={`${c.held.label} ${serviceLabel} ${HOLD_STATE_LABEL[c.held.state]}(이 기기)`}
              onClick={() => dispatch({ type: "select", date: c.held.date, start: c.held.start })}
            >
              {c.held.label}
              <small>{HOLD_STATE_LABEL[c.held.state]}</small>
            </button>
          ),
        )}
      </div>
    </li>
  );
}

function Sheet({
  sheet,
  copied,
  onCopy,
  onHold,
  onUndo,
  onClose,
}: {
  sheet: SheetView;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  onHold: (memo: string) => void;
  onUndo: (holdId: string) => void;
  onClose: () => void;
}) {
  const [memo, setMemo] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  // 닫기 함수는 부모가 그릴 때마다 새로 만든다. 열릴 때 한 번만 초점을 옮기고 Esc를 걸도록 ref로 최신 것을 본다.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h" tabIndex={-1} ref={ref}>
        <div className="sheet-head">
          <h2 id="sheet-h">
            {sheet.title} {sheet.rel && <span className="badge blue">{sheet.rel}</span>}
            <span className="sheet-svc">{sheet.serviceLabel}</span>
          </h2>
          <button type="button" className="sheet-close" onClick={onClose}>
            닫기
          </button>
        </div>
        {sheet.tags.length > 0 && (
          <p className="row">
            {sheet.tags.map((t) => (
              <span key={t} className={`badge ${t.includes("입금") || t.includes("취소") ? "orange" : "gray"}`}>
                {t}
              </span>
            ))}
          </p>
        )}
        {sheet.hold && (
          <p className="row held-status">
            <span className="badge gray">가예약(이 기기)</span>
            {sheet.holdState === "expiring" && <span className="badge orange">곧 풀림</span>}
            <span>
              {sheet.holdUntil}까지 유지 — {sheet.deposit ? "입금 기한" : "가예약 유지 기한"}[가정]
            </span>
          </p>
        )}
        <p className="note warn sheet-warn">
          <strong>확정 아님.</strong> 비어 있는 시간 안내입니다 — {sheet.deposit ? "입금을 확인하고 " : ""}확정 연락(카카오 채널·문자)을 보내야 확정됩니다. 가예약은 이 기기에서만 칸을 잡아 둡니다.
        </p>

        <h3>읽어 줄 문장</h3>
        <ComposedText c={sheet.readout} />
        {sheet.accountNote && (
          <p className="row">
            <span className="badge orange">{sheet.accountNote}</span>
          </p>
        )}

        {sheet.free ? (
          <div className="hold-form">
            <label>
              메모(선택)
              <input value={memo} maxLength={80} onChange={(e) => setMemo(e.target.value)} placeholder="예: 오후 선호, 입금 오늘 중" />
            </label>
            <p className="small muted">이름·연락처는 쓰지 마세요. 전화번호 모양은 가려서 저장합니다.</p>
          </div>
        ) : (
          sheet.hold && (
            <div className="held-box">
              <p className="small muted">예약 프로그램에 옮길 한 줄</p>
              {sheet.holdLine && <ComposedText c={sheet.holdLine} className="hold-line" />}
            </div>
          )
        )}

        <h3>확정 문자 틀</h3>
        <p className="small muted">{sheet.deposit ? "입금을 확인한 뒤" : "일정을 예약 프로그램에 옮긴 뒤"} 사람이 보냅니다. 이 도구는 보내지 않습니다.</p>
        {sheet.confirmation.ok && <CopyButton id="confirm" text={sheet.confirmation.text} label="확정 문자 틀 복사" copied={copied} onCopy={onCopy} />}
        <details className="fold">
          <summary>확정 문자 틀 보기</summary>
          <ComposedText c={sheet.confirmation} />
        </details>

        {/* 한 손: 자주 누르는 두 버튼은 시트 아래에 붙여 둔다(엄지가 닿는 곳, 스크롤해도 보임). */}
        <div className="sheet-actions">
          {sheet.free ? (
            <>
              {sheet.readout.ok && <CopyButton id="readout-slot" text={sheet.readout.text} label="문장 복사" copied={copied} onCopy={onCopy} />}
              <button type="button" className="primary hold-btn" onClick={() => onHold(memo)}>
                <span>가예약</span>
                <small>{sheet.wouldHoldUntil}까지 이 기기에서</small>
              </button>
            </>
          ) : (
            sheet.hold && (
              <>
                {sheet.holdLine?.ok && <CopyButton id="hold-line" text={sheet.holdLine.text} label="한 줄 복사" copied={copied} onCopy={onCopy} primary />}
                <button type="button" onClick={() => onUndo(sheet.hold!.id)}>
                  되돌리기
                </button>
              </>
            )
          )}
        </div>
      </div>
    </>
  );
}

function HoldsPanel({ rows, copied, onCopy, onUndo, onReset }: { rows: HoldRow[]; copied: string | null; onCopy: (key: string, text: string) => void; onUndo: (id: string) => void; onReset: () => void }) {
  return (
    <section className="card holds" aria-labelledby="holds-h">
      <h2 id="holds-h">이 기기 가예약 {rows.length}건</h2>
      <p className="small muted">이 브라우저에만 있습니다. 다른 직원 화면과 예약 프로그램에는 없으니, 한 줄을 복사해 예약 프로그램에 옮겨 적으세요.</p>
      <ul className="hold-list">
        {rows.map((r) => (
          <li key={r.hold.id}>
            <p className="row">
              <strong>{r.when}</strong> <span>{r.serviceLabel}</span>
              <span className={`badge ${r.state === "expiring" ? "orange" : "gray"}`}>{HOLD_STATE_LABEL[r.state]}</span>
              <span className="small muted">{r.until}까지</span>
            </p>
            {r.line.ok && <p className="hold-line small">{r.line.text}</p>}
            <div className="row">
              {r.line.ok && <CopyButton id={`row-${r.hold.id}`} text={r.line.text} label="한 줄 복사" copied={copied} onCopy={onCopy} />}
              <button type="button" onClick={() => onUndo(r.hold.id)}>
                되돌리기
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="link" onClick={onReset}>
        이 기기 가예약 모두 지우기
      </button>
    </section>
  );
}
