/**
 * 화면을 서버 렌더로 찍어 본다(renderToStaticMarkup, 다시봄과 같은 방식). 뷰 모델 시험(src/demo/call.test.ts)은 값을 보고,
 * 여기서는 컴포넌트가 그 값을 **어떻게 그리는지**(버튼의 눌림 표시, 휴진 줄, 칸 버튼, 시트의 문장·복사·가예약)를 본다.
 * 이 렌더는 localStorage가 없는 첫 화면이다(이 브라우저 가예약 없음). 가예약 뒤 모습은 CallLayout에 뷰 모델을 넣어 그린다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { localDate } from "@/core/calendar";
import { makeHold } from "@/core/holds";
import { callReducer, callView, holdRows, INITIAL_CALL, type CallAction, type CallState } from "@/demo/call";
import { DEMO_NOW, DEMO_NOW_MS } from "@/demo/clock";
import { mustDemo } from "@/demo/data";
import { CallLayout, CallScreen } from "./Call";
import { Chrome, isActiveTab, TABS } from "./Chrome";
import { ErrorPanel } from "./ErrorPanel";
import { EvalScreen } from "./Eval";
import { RulesScreen } from "./Rules";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
const { engine, schedule } = mustDemo();
const press = (...a: CallAction[]): CallState => a.reduce(callReducer, INITIAL_CALL);
const noop = () => {};
const questionText = (button: string, sub: string) => callView({ engine, schedule, holds: [], nowMs: DEMO_NOW_MS }, press({ type: "button", key: button }, { type: "sub", key: sub })).question!.text;
const layout = (state: CallState, holds = [] as ReturnType<typeof makeHold>[], copied: string | null = null) =>
  renderToStaticMarkup(
    <CallLayout
      view={callView({ engine, schedule, holds, nowMs: DEMO_NOW_MS }, state)}
      scopeLine={engine.rules.scopeLine}
      rows={holdRows(engine, holds, DEMO_NOW_MS)}
      dispatch={noop}
      copied={copied}
      onCopy={noop}
      onHold={noop}
      onUndo={noop}
      onReset={noop}
      notice={null}
    />,
  );

describe("위 띠와 머리(Chrome)", () => {
  const html = renderToStaticMarkup(<Chrome />);
  const t = text(html);
  it("띠: 가상 의원 · 합성 예약 · 기준 시각 · [가정] 규칙 · 가예약은 이 기기에서만, 가예약 수", () => {
    expect(t).toContain("가상 의원 · 합성 예약 · 기준 9/21(월) 10:00 · [가정] 규칙 — 병원 확인 전 · 가예약은 이 기기에서만");
    // 가예약이 없으면 띠 한 줄을 아낀다(0건은 적지 않음).
    expect(t).not.toContain("이 기기 가예약");
  });
  it("탭 셋과 네 도구 줄(접힘)", () => {
    expect(TABS.map((x) => x.label)).toEqual(["전화 받기", "규칙 보기", "평가"]);
    expect(html).toMatch(/<details class="tools"><summary>샘플의원 네 도구<\/summary>/);
    expect(t).toContain("빈자리(전화로 온 예약 요청의 빈 시간)");
    expect(isActiveTab("/", "/")).toBe(true);
    expect(isActiveTab("/", "/eval/")).toBe(false);
    expect(isActiveTab("/rules/", "/rules/")).toBe(true);
  });
});

describe("전화 받기 — 첫 화면(0~5초)", () => {
  const html = renderToStaticMarkup(<CallScreen />);
  const t = text(html);
  it("큰 버튼 셋이 맨 위, 눌리지 않음, 재시술 동의어, 범위 한 줄", () => {
    const big = [...html.matchAll(/<button type="button" class="big-btn" aria-pressed="(\w+)"><span class="big-label">([^<]+)<\/span>/g)].map((m) => [m[2], m[1]]);
    expect(big).toEqual([
      ["상담", "false"],
      ["시술", "false"],
      ["재시술", "false"],
    ]);
    expect(t).toContain("보강 · 추가 이식 · 재수술");
    expect(t).toContain("예약 변경·수술 후 경과 진료 → 예약표에서 확인(이 도구 밖)");
  });
  it("누르기 전: 무엇을 하면 되는지 한 줄", () => {
    expect(t).toContain("고객이 원하는 것 하나를 누르세요");
  });
  it("누르기 전에는 질문·목록·시트·가예약 목록이 없다", () => {
    for (const cls of ['class="question"', 'class="results"', 'class="sheet"', 'class="card holds"']) expect(html).not.toContain(cls);
  });
});

describe("상담 → 예, 처음(5~12초)", () => {
  const html = renderToStaticMarkup(<CallScreen initial={press({ type: "button", key: "consult" }, { type: "answer", key: "first" })} />);
  const t = text(html);
  it("누른 버튼·대답이 눌림으로 보이고, 질문이 남아 있다(바꿀 수 있게)", () => {
    expect(html).toMatch(/aria-pressed="true"><span class="big-label">상담<\/span>/);
    expect(html).toMatch(/class="answer" aria-pressed="true">예, 처음<\/button>/);
    expect(t).toContain("처음 오시나요?");
  });
  it("거르개(시간대·날짜로 이동·요일)가 목록 위에, 빈 시간 수와 첫 예약 가능 시각", () => {
    const f = html.indexOf('aria-label="거르개"');
    const list = html.indexOf('class="days"');
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(list);
    for (const l of ["오전", "낮·오후", "저녁", "월", "화", "수", "목", "금", "토"]) expect(html).toContain(`aria-pressed="false">${l}</button>`);
    expect(t).toContain("날짜로 이동");
    expect(t).toContain("빈 시간 38칸");
    expect(t).toContain("첫 가능 9/21(월) 11:00");
  });
  it("오늘 줄: 날짜·오늘·입금 즉시 확인 필요, 칸 버튼은 가장 빠른 것부터", () => {
    const chips = [...html.matchAll(/<button type="button" class="slot" aria-label="([^"]+)">(\d\d:\d\d)<\/button>/g)].map((m) => m[2]);
    expect(chips.slice(0, 5)).toEqual(["11:00", "11:30", "14:00", "17:30", "12:00"]);
    expect(html).toContain('aria-label="9/21(월) 11:00 첫 상담 빈 시간"');
    const today = text(html.slice(html.indexOf('class="day slots"'), html.indexOf('class="slot-row"')));
    expect(today).toContain("9/21(월) 오늘 입금 즉시 확인 필요");
  });
  it("휴진 줄: 추석 연휴·일요일 한 줄(누르면 읽어 줄 문장), 9/23 예약 꽉 참 뒤·9/28 앞", () => {
    const i = html.indexOf("9/24(목)~9/27(일) 추석 연휴·일요일 — 휴진");
    expect(html).toMatch(/<li class="day off closed"><details><summary class="off-text">9\/24\(목\)~9\/27\(일\) 추석 연휴·일요일 — 휴진<\/summary>/);
    expect(t).toContain("9월 24일 목요일부터 9월 27일 일요일까지는 휴진입니다(추석 연휴·일요일). 가장 가까운 빈 시간은 9월 28일 월요일 오전 10시입니다.");
    expect(html.indexOf("9/23(수) 예약 꽉 참")).toBeLessThan(i);
    expect(html.indexOf('class="day-date">9/28(월)')).toBeGreaterThan(i);
  });
  it("먼저 말할 두 칸은 늘 보이고, 긴 문장만 접혀 있고 목록보다 위, 입금 안내 자리표시는 문장 밖", () => {
    expect(html).toContain('<details class="fold readout-fold"><summary>고객에게 읽어 줄 문장 펼치기</summary>');
    expect(t).toContain("먼저 말할 시간 9/21(월) 11:00 · 9/21(월) 14:00");
    expect(html.indexOf("suggest-line")).toBeLessThan(html.indexOf("readout-fold"));
    const r0 = html.indexOf('class="readout"');
    expect(text(html.slice(r0, html.indexOf("</div>", r0)))).not.toContain("예약 프로그램 문구");
    expect(html).toContain('<span class="badge orange">입금 안내는 예약 프로그램 문구 사용</span>');
    expect(html.indexOf("readout-fold")).toBeLessThan(html.indexOf('class="days"'));
  });
  it("14일 더 보기 버튼", () => {
    expect(html).toContain('class="more">14일 더 보기</button>');
  });
});

describe("시트(12~24초)", () => {
  const base = press({ type: "button", key: "consult" }, { type: "answer", key: "first" }, { type: "select", date: localDate("2026-09-22"), start: "12:00" });
  it("빈 칸을 누르면: 확정 아님 경고, 읽어 줄 문장, 문장 복사, 메모(선택)·이름 쓰지 말라는 안내, 가예약 버튼, 확정 문자 틀 복사", () => {
    const html = layout(base);
    const sheet = html.slice(html.indexOf('class="sheet"'));
    const t = text(sheet);
    expect(sheet).toContain('role="dialog" aria-modal="true" aria-labelledby="sheet-h"');
    expect(t).toContain("9/22(화) 12:00~13:00 내일 첫 상담");
    expect(t).toContain("확정 아님.");
    expect(t).toContain("내일 9월 22일 화요일 낮 12시에 자리가 있습니다.");
    expect(t).toContain("가까운 날짜라 입금을 바로 확인해야 하고, 확정 연락(카카오 채널이나 문자)을 드려야 예약이 확정됩니다.");
    expect(t).toContain("입금을 확인하고 확정 연락(카카오 채널·문자)을 보내야 확정됩니다");
    expect(t).toContain("입금을 확인한 뒤 사람이 보냅니다");
    expect(sheet).toContain(">문장 복사</button>");
    expect(t).toContain("이름·연락처는 쓰지 마세요");
    expect(sheet).toMatch(/<span>가예약<\/span><small>9\/22\(화\) 12:00(<!-- -->)?까지 이 기기에서<\/small>/);
    expect(sheet).toContain(">확정 문자 틀 복사</button>");
    expect(sheet).not.toContain(">되돌리기</button>");
    // 고객에게 읽는 문장 상자에는 '가예약'이라는 말이 없다.
    const r0 = sheet.indexOf('class="readout"');
    const readout = text(sheet.slice(r0, sheet.indexOf("</div>", r0)));
    expect(readout).toContain("지금 비어 있는 시간을 말씀드릴게요.");
    expect(readout).not.toContain("가예약");
  });
  it("가예약한 칸: 목록에는 회색 가예약 칩, 시트에는 옮길 한 줄·한 줄 복사·되돌리기, 아래에 이 기기 가예약 목록", () => {
    const hold = makeHold({ service: "first-consult", date: localDate("2026-09-22"), start: "12:00", createdAt: DEMO_NOW, memo: "오후 선호" });
    const html = layout(base, [hold], "hold-line");
    expect(html).toMatch(/class="slot held" aria-label="12:00 첫 상담 가예약\(이 기기\)">12:00<small>가예약<\/small><\/button>/);
    // 가예약 칸도 시각 순서 자리에(9/22: 12:00 가예약 → 14:00 → 18:00).
    const row = html.slice(html.indexOf('class="day-date">9/22(화)'), html.indexOf("</li>", html.indexOf('class="day-date">9/22(화)')));
    expect([...row.matchAll(/>(\d\d:\d\d)(<small>|<\/button>)/g)].map((m) => m[1])).toEqual(["12:00", "14:00", "18:00"]);
    const sheet = html.slice(html.indexOf('class="sheet"'));
    const t = text(sheet);
    expect(t).toContain("가예약(이 기기)");
    expect(t).toContain("9/22(화) 12:00까지 유지 — 입금 기한[가정]");
    expect(t).toContain("2026-09-22(화) 12:00~13:00 첫 상담 · 입금 대기(빈자리 가예약, 9/22(화) 12:00까지) · 메모: 오후 선호");
    expect(sheet).toContain(">한 줄 복사</button>");
    expect(sheet).toContain(">되돌리기</button>");
    expect(t).toContain("복사했습니다");
    expect(sheet).not.toContain("<span>가예약</span>");
    const panel = text(html.slice(html.indexOf('class="card holds"'), html.indexOf('class="sheet-backdrop"')));
    expect(panel).toContain("이 기기 가예약 1건");
    expect(panel).toContain("9/22(화) 12:00 첫 상담");
    expect(panel).toContain("이 기기 가예약 모두 지우기");
  });
});

describe("시술 → 모발이식 수술 → 예(24~30초)", () => {
  const html = renderToStaticMarkup(<CallScreen initial={press({ type: "button", key: "procedure" }, { type: "sub", key: "surgery" }, { type: "answer", key: "yes" })} />);
  const t = text(html);
  it("하위 칩 셋, 크기 칩(하루 기본), 첫 칸 9/28 10:00과 다음 날 내원", () => {
    expect(html).toMatch(/class="chip sub" aria-pressed="true">모발이식 수술<\/button>/);
    expect(html).toMatch(/aria-pressed="true">하루\(기본\)<\/button>/);
    expect(t).toContain("9/28(월) 다음 날 내원 9/29(화) 14일 안 수술 — 취소·변경은 원무팀 개별 안내(V04)");
    // 수술엔 시간대 칩과 토요일 칩이 없다.
    expect(html).not.toContain('aria-pressed="false">저녁</button>');
    expect(html).not.toContain('aria-pressed="false">토</button>');
    expect(html).toContain('aria-label="9/28(월) 10:00 모발이식 수술(하루) 빈 시간">10:00</button>');
  });
  it("이 안건만 안 되는 날은 까닭 한 줄(주황 줄)", () => {
    expect(html).toMatch(/<li class="day off service-unavailable"><span class="off-text">10\/2\(금\) 수술 불가 — 다음 날 10\/3\(토\) 개천절 휴진<\/span><\/li>/);
  });
});

describe("예약금 없는 안건의 시트(상담실장 점검 2)", () => {
  it("리터치(재진 상담): '입금'을 말하지 않고 확정 연락만, 가예약 유지 기한, 집도 의료진 경고는 결과 제목 바로 아래", () => {
    const s = press({ type: "button", key: "retouch" }, { type: "answer", key: "here" });
    const list = renderToStaticMarkup(<CallScreen initial={s} />);
    const warn = list.indexOf("담당(집도) 의료진 일정은 예약표에서 확인");
    expect(warn).toBeGreaterThan(0);
    expect(warn).toBeLessThan(list.indexOf('aria-label="거르개"'));
    const first = /aria-label="(\d+\/\d+)\([^)]+\) (\d\d:\d\d) 의료진 재진 상담 빈 시간"/.exec(list)!;
    const [m, d] = first[1].split("/").map(Number);
    const date = localDate(`2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    const hold = makeHold({ service: "revisit-consult", date, start: first[2], createdAt: DEMO_NOW });
    for (const html of [layout(callReducer(s, { type: "select", date, start: first[2] })), layout(callReducer(s, { type: "select", date, start: first[2] }), [hold])]) {
      const sheet = text(html.slice(html.indexOf('class="sheet"')));
      expect(sheet).not.toContain("입금");
      expect(sheet).toContain("확정 연락(카카오 채널·문자)을 보내야 확정됩니다");
    }
    expect(text(layout(callReducer(s, { type: "select", date, start: first[2] }), [hold]))).toContain("가예약 유지 기한[가정]");
  });
});

describe("좁은 폭(360px) 넘침 막기", () => {
  it("질문 글에 nowrap을 걸지 않는다(두피 주사 질문이 363px로 넘쳤다)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../globals.css", import.meta.url), "utf8");
    const q = css.slice(css.indexOf(".q-text {"), css.indexOf("}", css.indexOf(".q-text {")));
    expect(q).not.toContain("nowrap");
    expect(questionText("procedure", "injection").length).toBeLessThanOrEqual(12);
  });
});

describe("첫 상담으로 바뀜", () => {
  it("시술 → 두피 주사 → 처음(진찰 전): 까닭을 경고 상자로", () => {
    const t = text(renderToStaticMarkup(<CallScreen initial={press({ type: "button", key: "procedure" }, { type: "sub", key: "injection" }, { type: "answer", key: "new" })} />));
    expect(t).toContain("처음 오시는 분은 첫 상담부터(V05·V08) — 첫 상담 빈 시간을 보여 드립니다.");
  });
});

describe("규칙 오류 화면", () => {
  it("멈춤 제목과 직원이 할 일", () => {
    const t = text(renderToStaticMarkup(<ErrorPanel errors={["B01: slotMinutes가 없습니다"]} />));
    expect(t).toContain("규칙 오류 — 예약표에서 직접 확인");
    expect(t).toContain("B01: slotMinutes가 없습니다");
  });
});

describe("규칙 보기", () => {
  const html = renderToStaticMarkup(<RulesScreen />);
  const t = text(html);
  it("B01이 [가정] 초안임을 맨 위에, 문서 12편", () => {
    expect(t).toContain("예약 칸 규칙(B01)은 [가정] 문서입니다.");
    expect(t).toContain("status: draft, approvedBy: none");
    expect((html.match(/<details class="fold"><summary>[BV]\d\d /g) ?? []).length).toBe(12);
  });
  it("엔진이 읽은 값: 진료시간·점심·안건 단계·사람 수·공휴일", () => {
    expect(t).toContain("월 10:00~19:00");
    expect(t).toContain("목 10:00~21:00");
    expect(t).toContain("13:00~14:00 · 월화수목금요일");
    expect(t).toContain("간호 0~20분 · 의료진 20~40분 · 코디 40~60분 · 상담실 0~60분");
    expect(t).toContain("목요일 19:00~21:00 : 의료진 1 · 코디 1 · 간호 1");
    expect(t).toContain("30,000원(deposit-consult)");
    expect(t).toContain("10/16(금) 내부 교육");
  });
  it("버튼·질문·대답 표", () => {
    expect(t).toContain("재시술 여기서 수술 받으셨나요? 예, 여기서 의료진 재진 상담");
    expect(t).toContain("모발이식 수술(하루) / 모발이식 수술(반나절)(첫 값이 기본)");
  });
});

describe("평가", () => {
  // 화면은 10분 간격(빌드 때 한 번). 시험은 같은 컴포넌트를 6시간 간격으로 그려 모양만 본다.
  const t = text(renderToStaticMarkup(<EvalScreen stepMinutes={360} />));
  it("편향·검수 전을 맨 위에, 하지 않은 것은 미실시로", () => {
    expect(t.indexOf("AI 작성·오너 검수 전")).toBeLessThan(t.indexOf("규칙 위반"));
    expect(t).toContain("별도 구현 대조 3,580 / 3,580행");
    expect(t).toContain("오너 손 검수 미실시");
  });
  it("규칙 위반 0건과 분모, 경계 사례, 결정성, 조작 수", () => {
    expect(t).toContain("규칙 위반(따로 짠 검사기) 0건");
    expect(t).toMatch(/점심과 겹침 0 \/ [1-9][\d,]*/);
    expect(t).toContain("심은 경계 사례 32 / 32");
    expect(t).toContain("결정성 0건");
    expect(t).toContain("상담 → 예, 처음 첫 상담 2번");
    expect(t).toContain("시술 → 모발이식 수술 → 예 모발이식 수술(하루) 3번");
  });
});
