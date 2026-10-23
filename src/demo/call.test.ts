import { describe, expect, it } from "vitest";
import { localDate } from "@/core/calendar";
import { makeHold } from "@/core/holds";
import { bandText, callReducer, callView, holdRows, INITIAL_CALL, pressPaths, type CallAction, type CallState } from "./call";
import { DEMO_NOW, DEMO_NOW_MS } from "./clock";
import { mustDemo } from "./data";

/**
 * 통화 중 한 화면의 뷰 모델(PRD 3절 30초 시연). 화면 컴포넌트는 이 값을 그리기만 하므로,
 * "무엇을 누르면 무엇이 보이나"를 여기서 본다. 기대값은 합성 예약(data/bookings.json)과 기준 시각 9/21(월) 10:00 기준.
 */

const { engine, schedule } = mustDemo();
const input = { engine, schedule, holds: [], nowMs: DEMO_NOW_MS };
const press = (...actions: CallAction[]): CallState => actions.reduce(callReducer, INITIAL_CALL);
const D = localDate;

const consultFirst = press({ type: "button", key: "consult" }, { type: "answer", key: "first" });
const surgeryYes = press({ type: "button", key: "procedure" }, { type: "sub", key: "surgery" }, { type: "answer", key: "yes" });

describe("첫 화면(0~5초)", () => {
  const v = callView(input, INITIAL_CALL);
  it("큰 버튼 셋 — 상담 · 시술 · 재시술, 재시술에는 고객이 쓰는 말", () => {
    expect(v.buttons.map((b) => b.label)).toEqual(["상담", "시술", "재시술"]);
    expect(v.buttons.find((b) => b.key === "retouch")?.hint).toBe("보강 · 추가 이식 · 재수술");
    expect(v.buttons.every((b) => !b.pressed)).toBe(true);
  });
  it("누르기 전에는 질문도 목록도 없다", () => {
    expect([v.subs, v.question, v.result, v.sheet]).toEqual([null, null, null, null]);
  });
  it("띠: 가상 의원 · 합성 예약 · 기준 시각 · [가정] 규칙 · 가예약은 이 기기에서만", () => {
    expect(bandText(engine, DEMO_NOW_MS)).toBe("가상 의원 · 합성 예약 · 기준 9/21(월) 10:00 · [가정] 규칙 — 병원 확인 전 · 가예약은 이 기기에서만");
  });
});

describe("상담 → 예, 처음(5~12초)", () => {
  it("상담을 누르면 질문 '처음 오시나요?'와 대답 둘", () => {
    const v = callView(input, press({ type: "button", key: "consult" }));
    expect(v.question?.text).toBe("처음 오시나요?");
    expect(v.question?.answers.map((a) => a.label)).toEqual(["예, 처음", "아니오, 재진"]);
    expect(v.result).toBeNull();
  });

  const v = callView(input, consultFirst);
  const r = v.result!;
  it("첫 상담 60분, 14일(9/21~10/4), 첫 예약 가능 11:00", () => {
    expect(r.service).toMatchObject({ key: "first-consult", label: "첫 상담", minutes: 60 });
    expect(r.rangeText).toBe("9/21(월)~10/4(일) · 14일");
    expect(r.earliestText).toBe("첫 가능 9/21(월) 11:00");
    expect(r.count).toBe(38);
  });
  it("오늘 줄이 맨 위, 가장 빠른 칸부터, '입금 즉시 확인 필요'는 날짜 줄에 한 번", () => {
    const [today, tomorrow] = r.lines;
    expect([today.text, today.rel, today.slots.map((s) => s.start)]).toEqual(["9/21(월)", "오늘", ["11:00", "11:30", "14:00", "17:30"]]);
    expect(today.tags).toEqual(["입금 즉시 확인 필요"]);
    expect([tomorrow.text, tomorrow.rel]).toEqual(["9/22(화)", "내일"]);
  });
  it("휴진은 건너뛴 날과 사유 한 줄: 9/23 다음에 추석 연휴·일요일, 이어서 9/28", () => {
    const texts = r.lines.map((l) => l.text);
    const i = texts.indexOf("9/24(목)~9/27(일) 추석 연휴·일요일 — 휴진");
    expect(i).toBeGreaterThan(0);
    expect(texts[i - 1]).toBe("9/23(수) 예약 꽉 참");
    expect(texts[i + 1]).toBe("9/28(월)");
    expect(r.lines[i].kind).toBe("closed");
    expect(texts).toContain("9/30(수) 예약 꽉 참");
  });
  it("휴진 줄에는 '추석 중에 되나요?'에 답할 한 문장(휴진 사유 + 그 뒤 가장 가까운 빈 시간)", () => {
    const l = r.lines.find((x) => x.kind === "closed")!;
    expect(l.say?.ok && l.say.text).toBe("9월 24일 목요일부터 9월 27일 일요일까지는 휴진입니다(추석 연휴·일요일). 가장 가까운 빈 시간은 9월 28일 월요일 오전 10시입니다.");
    expect(r.lines.filter((x) => x.kind !== "closed").every((x) => x.say === null)).toBe(true);
  });
  it("모든 날짜가 오름차순이고, 칸도 날짜 안에서 오름차순", () => {
    const starts = r.lines.flatMap((l) => l.slots.map((s) => `${s.date} ${s.start}`));
    expect([...starts].sort()).toEqual(starts);
  });
  it("제안 두 칸과 읽어 줄 문장(펼치기 전): 확정이 아닌 안내 + V04 확정 조건", () => {
    expect(r.suggestions.map((s) => `${s.date} ${s.start}`)).toEqual(["2026-09-21 11:00", "2026-09-21 14:00"]);
    expect(r.readout?.ok).toBe(true);
    if (!r.readout?.ok) return;
    expect(r.readout.lines[0]).toBe("지금 비어 있는 시간을 말씀드릴게요.");
    expect(r.readout.text).toContain("오늘 9월 21일 월요일 오전 11시, 또는 같은 날 오후 2시");
    expect(r.readout.lines.at(-1)).toBe("가까운 날짜라 입금을 바로 확인해야 하고, 확정 연락(카카오 채널이나 문자)을 드려야 예약이 확정됩니다.");
    expect(r.readout.text).not.toContain("가예약");
    expect(r.deposit).toBe(true);
    expect(r.accountNote).toBe("입금 안내는 예약 프로그램 문구 사용");
  });
});

describe("거르개(F12)", () => {
  it("저녁: 18:00 이후 칸만 남고, 제안 칸도 그 안에서 다시 고른다", () => {
    const r = callView(input, callReducer(consultFirst, { type: "toggleBand", band: "evening" })).result!;
    const all = r.lines.flatMap((l) => l.slots);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => s.start >= "18:00")).toBe(true);
    expect(all.map((s) => `${s.date} ${s.start}`)).toContain("2026-10-01 20:00");
    expect(r.suggestions.every((s) => s.start >= "18:00")).toBe(true);
    expect(r.filtered).toBe(true);
    expect(r.totalCount).toBe(38);
  });
  it("'첫 가능'은 실제로 빈 첫 칸 — 접수 규칙이 가리키는 9/21 11:00이 차 있으면 목록의 첫 칸(9/22 12:00)", () => {
    const hold = makeHold({ service: "first-consult", date: D("2026-09-21"), start: "11:00", createdAt: DEMO_NOW });
    const r = callView({ ...input, holds: [hold] }, consultFirst).result!;
    const first = r.lines.find((l) => l.kind === "slots")!.slots[0];
    expect(`${first.date} ${first.start}`).toBe("2026-09-22 12:00");
    expect(r.earliestText).toBe("첫 가능 9/22(화) 12:00");
  });
  it("거르면 '첫 가능 9/21 11:00' 대신 거른 결과의 첫 칸, 칸이 없으면 숨김", () => {
    const thuEve = callView(input, press({ type: "button", key: "consult" }, { type: "answer", key: "first" }, { type: "toggleDow", dow: "thu" }, { type: "toggleBand", band: "evening" })).result!;
    expect(thuEve.earliestText).toBe("첫 칸 10/1(목) 20:00");
    const sat = callView(input, callReducer(consultFirst, { type: "toggleDow", dow: "sat" })).result!;
    expect(sat.earliestText).toBeNull();
  });
  it("토요일: 14일 안의 토요일은 추석 연휴·개천절이라 없음 — 까닭과 함께", () => {
    const r = callView(input, callReducer(consultFirst, { type: "toggleDow", dow: "sat" })).result!;
    expect(r.count).toBe(0);
    expect(r.emptyText).toContain("토요일");
    expect(r.emptyText).toContain("9/26 추석");
    expect(r.emptyText).toContain("10/3 개천절");
    expect(r.readout).toBeNull();
  });
  it("날짜로 이동: 고른 날부터, 선택지는 빈 칸이 있는 날과 휴진일", () => {
    const base = callView(input, consultFirst).result!;
    expect(base.jump.options.map((o) => o.label)).toEqual([
      "9/21(월) 오늘",
      "9/22(화) 내일",
      "9/24(목) 휴진",
      "9/25(금) 휴진",
      "9/26(토) 휴진",
      "9/27(일) 휴진",
      "9/28(월)",
      "9/29(화)",
      "10/1(목)",
      "10/3(토) 휴진",
      "10/4(일) 휴진",
    ]);
    const r = callView(input, callReducer(consultFirst, { type: "jump", date: D("2026-09-28") })).result!;
    expect(r.lines[0].text).toBe("9/28(월)");
  });
  it("거르개 풀기는 셋 다 비운다", () => {
    const s = press({ type: "button", key: "consult" }, { type: "answer", key: "first" }, { type: "toggleDow", dow: "mon" }, { type: "toggleBand", band: "morning" }, { type: "jump", date: D("2026-09-28") }, { type: "clearFilter" });
    expect([s.dows, s.bands, s.jump]).toEqual([[], [], null]);
  });
  it("14일 더 보기: 28일로 늘어난다", () => {
    const r = callView(input, callReducer(consultFirst, { type: "more", days: 14 })).result!;
    expect(r.rangeText).toBe("9/21(월)~10/18(일) · 28일");
  });
});

describe("시술 → 모발이식 수술 → 예(24~30초)", () => {
  it("시술을 누르면 하위 칩 셋, 칩을 누르기 전에는 질문이 없다", () => {
    const v = callView(input, press({ type: "button", key: "procedure" }));
    expect(v.subs?.map((s) => s.label)).toEqual(["모발이식 수술", "두피 주사", "두피 관리"]);
    expect(v.question).toBeNull();
  });
  const v = callView(input, surgeryYes);
  const r = v.result!;
  it("크기: 하루(기본) · 반나절, 기본은 하루", () => {
    expect(v.sizes).toEqual([
      { key: "surgery-full", label: "하루(기본)", pressed: true },
      { key: "surgery-half", label: "반나절", pressed: false },
    ]);
    expect(r.service.key).toBe("surgery-full");
    expect(r.earliestText).toBe("수술은 9/28(월)부터[가정]");
  });
  it("기준일 + 7일 전 날은 줄로 늘어놓지 않는다 — 목록이 9/28부터 시작", () => {
    expect(r.lines[0].text).toBe("9/28(월)");
    expect(r.lines.some((l) => l.kind === "too-soon")).toBe(false);
  });
  it("첫 칸 9/28(월) 10:00, 다음 날 내원과 14일 안 취소·변경 안내", () => {
    const first = r.lines.find((l) => l.kind === "slots")!;
    expect(first.text).toBe("9/28(월)");
    expect(first.slots.map((s) => s.start)).toEqual(["10:00"]);
    expect(first.tags).toEqual(["다음 날 내원 9/29(화)", "14일 안 수술 — 취소·변경은 원무팀 개별 안내(V04)"]);
  });
  it("수술 거르개: 시간대 칩 없음(시작 시각이 정해짐), 요일 칩에 토요일 없음(V02 토요일 수술 없음), 기간은 첫 가능일부터", () => {
    expect(r.bands).toEqual([]);
    expect(r.dows.map((d) => d.label)).toEqual(["월", "화", "수", "목", "금"]);
    expect(r.rangeText).toBe("9/28(월)~10/18(일) · 21일");
    expect(r.jump.options.every((o) => o.date >= "2026-09-28")).toBe(true);
  });
  it("10/2는 다음 날 개천절이라 불가, 토요일은 수술 없는 날", () => {
    const texts = r.lines.map((l) => l.text);
    expect(texts).toContain("10/2(금) 수술 불가 — 다음 날 10/3(토) 개천절 휴진");
    expect(texts.some((t) => t.startsWith("10/10(토) 수술 없는 날"))).toBe(true);
  });
  it("반나절로 바꾸면 결과가 바뀐다(14:30 시작 칸)", () => {
    const h = callView(input, callReducer(surgeryYes, { type: "size", key: "surgery-half" })).result!;
    expect(h.service.key).toBe("surgery-half");
    expect(h.lines.flatMap((l) => l.slots).map((s) => `${s.date} ${s.start}`)).toContain("2026-09-29 14:30");
  });
});

describe("대답에 따라 바뀌는 안건", () => {
  it("시술 → 두피 관리 → 예, 처음: 첫 상담으로 바뀌고 까닭을 보인다", () => {
    const r = callView(input, press({ type: "button", key: "procedure" }, { type: "sub", key: "scalp-care" }, { type: "answer", key: "first" })).result!;
    expect(r.service.key).toBe("first-consult");
    expect(r.redirect).toBe("처음 오시는 분은 첫 상담부터(V05)");
  });
  it("재시술 → 예, 여기서: 의료진 재진 상담(바로 수술 아님), 집도 의료진 안내", () => {
    const r = callView(input, press({ type: "button", key: "retouch" }, { type: "answer", key: "here" })).result!;
    expect(r.service.key).toBe("revisit-consult");
    expect(r.hint).toBe("보강 · 추가 이식 · 재수술");
    // 집도 의료진 경고는 목록 아래 안내가 아니라 결과 제목 아래 경고로.
    expect(r.warnings).toEqual(["담당(집도) 의료진 일정은 예약표에서 확인"]);
    expect(r.notes).not.toContain("담당(집도) 의료진 일정은 예약표에서 확인");
    expect(r.deposit).toBe(false);
    expect(r.accountNote).toBeNull();
    expect(r.readout?.ok && r.readout.text).toContain("상담 비용은 방문하실 때 안내드립니다");
  });
  it("재시술 → 다른 병원: 첫 상담", () => {
    const r = callView(input, press({ type: "button", key: "retouch" }, { type: "answer", key: "elsewhere" })).result!;
    expect(r.service.key).toBe("first-consult");
    expect(r.redirect).toContain("다른 병원");
  });
  it("두피 주사 → 회차 옮기기: 예정일을 고르기 전에는 목록이 없고, 고르면 앞뒤 3일 창 안만", () => {
    const s = press({ type: "button", key: "procedure" }, { type: "sub", key: "injection" }, { type: "answer", key: "move" });
    const before = callView(input, s);
    expect(before.move?.value).toBeNull();
    expect(before.result).toBeNull();
    const r = callView(input, callReducer(s, { type: "moveDue", date: D("2026-10-01") })).result!;
    expect(r.rangeText).toBe("9/28(월)~10/4(일) · 7일");
    expect(r.earliestText).toBe(r.lines.flatMap((l) => l.slots).length > 0 ? `첫 칸 ${r.lines.find((l) => l.kind === "slots")!.text} ${r.lines.find((l) => l.kind === "slots")!.slots[0].start}` : null);
    expect(r.more).toBeNull();
    // 예정일 선택지에 일요일은 없다(회차는 일요일에 잡히지 않는다).
    expect(before.move!.options.some((o) => o.label.includes("(일)"))).toBe(false);
    expect(before.move!.options[0].date).toBe("2026-09-18");
    expect(r.lines.flatMap((l) => l.slots).every((x) => x.date >= "2026-09-28" && x.date <= "2026-10-04")).toBe(true);
  });
  it("앞 단계를 다시 누르면 뒤 단계(대답·거르개·누른 칸)를 비운다", () => {
    const s = press({ type: "button", key: "consult" }, { type: "answer", key: "first" }, { type: "toggleBand", band: "evening" }, { type: "select", date: D("2026-09-22"), start: "12:00" }, { type: "button", key: "procedure" });
    expect(s).toEqual({ ...INITIAL_CALL, button: "procedure" });
  });
});

describe("조작 수(설계상 값)", () => {
  const paths = pressPaths(input);
  it("모든 길에서 목록이 뜬다", () => {
    expect(paths.every((p) => p.presses > 0)).toBe(true);
    expect(paths).toHaveLength(11); // 상담 2 + 수술 2 + 주사 3 + 관리 2 + 재시술 2
  });
  it("상담·재시술 2번, 시술 3번, 회차 옮기기만 예정일 고르기로 4번", () => {
    const by = Object.fromEntries(paths.map((p) => [p.path, p.presses]));
    expect(by["상담 → 예, 처음"]).toBe(2);
    expect(by["재시술 → 예, 여기서"]).toBe(2);
    expect(by["시술 → 모발이식 수술 → 예"]).toBe(3);
    expect(by["시술 → 두피 관리 → 아니오"]).toBe(3);
    expect(by["시술 → 두피 주사 → 회차 옮기기"]).toBe(4);
    expect(paths.filter((p) => !p.path.endsWith("회차 옮기기")).every((p) => p.presses <= 3)).toBe(true);
  });
});

describe("칸 누르기 → 시트(12~24초)", () => {
  const sel = callReducer(consultFirst, { type: "select", date: D("2026-09-22"), start: "12:00" });
  it("빈 칸: 그 칸 하나로 읽어 줄 문장, 확정 문자 틀, 가예약 전 유지 시각", () => {
    const sh = callView(input, sel).sheet!;
    expect(sh.title).toBe("9/22(화) 12:00~13:00");
    expect(sh.rel).toBe("내일");
    expect(sh.free).toBe(true);
    expect(sh.tags).toEqual(["입금 즉시 확인 필요"]);
    expect(sh.readout.ok && sh.readout.text).toContain("내일 9월 22일 화요일 낮 12시에 자리가 있습니다.");
    expect(sh.readout.ok && sh.readout.text).toContain("가까운 날짜라 입금을 바로 확인해야 하고, 확정 연락(카카오 채널이나 문자)을 드려야 예약이 확정됩니다.");
    expect(sh.deposit).toBe(true);
    expect(sh.readout.ok && sh.readout.text).not.toContain("가예약");
    expect(sh.confirmation.ok && sh.confirmation.text).toContain("9월 22일(화) 낮 12시 첫 상담 예약이 확정되었습니다");
    // 가예약하면 다음 영업일 19:00까지인데, 칸 시작(9/22 12:00)을 넘지 않는다.
    expect(sh.wouldHoldUntil).toBe("9/22(화) 12:00");
  });
  it("가예약한 칸: 목록에서 빠지고 회색 가예약 칩으로, 시트는 옮길 한 줄과 되돌리기", () => {
    const hold = makeHold({ service: "first-consult", date: D("2026-09-22"), start: "12:00", createdAt: DEMO_NOW, memo: "오후 선호 010-1234-5678" });
    const v = callView({ ...input, holds: [hold] }, sel);
    const line = v.result!.lines.find((l) => l.text === "9/22(화)")!;
    expect(line.slots.map((s) => s.start)).not.toContain("12:00");
    expect(line.held).toEqual([{ holdId: hold.id, date: "2026-09-22", start: "12:00", label: "12:00", state: "alive" }]);
    const sh = v.sheet!;
    expect(sh.free).toBe(false);
    expect(sh.holdUntil).toBe("9/22(화) 12:00");
    expect(sh.holdLine?.ok && sh.holdLine.text).toMatch(/^2026-09-22\(화\) 12:00~13:00 첫 상담 · 입금 대기\(빈자리 가예약, 9\/22\(화\) 12:00까지\) · 메모: 오후 선호 /);
    expect(sh.holdLine?.ok && sh.holdLine.text).not.toContain("1234-5678");
    // 가예약 칸의 안내 문장도 빈 칸일 때와 같다(입금 즉시 확인 필요).
    expect(sh.tags).toEqual(["입금 즉시 확인 필요"]);
    expect(v.result!.count).toBe(37);
  });
  it("이 기기 가예약 목록: 안건·날짜·풀리는 시각", () => {
    const hold = makeHold({ service: "first-consult", date: D("2026-09-22"), start: "12:00", createdAt: DEMO_NOW });
    const rows = holdRows(engine, [hold], DEMO_NOW_MS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serviceLabel: "첫 상담", when: "9/22(화) 12:00", until: "9/22(화) 12:00" });
  });
  it("예약금 없는 안건(주사) 시트: deposit false, 옮길 한 줄은 '확정 연락 대기'", () => {
    const inj = press({ type: "button", key: "procedure" }, { type: "sub", key: "injection" }, { type: "answer", key: "start" });
    const first = callView(input, inj).result!.lines.find((l) => l.kind === "slots")!.slots[0];
    const sh = callView(input, callReducer(inj, { type: "select", date: first.date, start: first.start })).sheet!;
    expect(sh.deposit).toBe(false);
    expect(sh.accountNote).toBeNull();
    const hold = makeHold({ service: "injection", date: first.date, start: first.start, createdAt: DEMO_NOW });
    const held = callView({ ...input, holds: [hold] }, callReducer(inj, { type: "select", date: first.date, start: first.start })).sheet!;
    expect(held.holdLine?.ok && held.holdLine.text).toContain("확정 연락 대기(빈자리 가예약");
    expect(held.holdLine?.ok && held.holdLine.text).not.toContain("입금");
  });
  it("모든 질문에서 '예'(또는 처음)가 맨 왼쪽 — 통화 중 잘못 누르지 않게", () => {
    for (const [b, sub] of [["consult"], ["procedure", "surgery"], ["procedure", "scalp-care"], ["retouch"]] as const) {
      const s = sub ? press({ type: "button", key: b }, { type: "sub", key: sub }) : press({ type: "button", key: b });
      expect(callView(input, s).question!.answers[0].label, `${b}/${sub}`).toMatch(/^예/);
    }
  });
  it("거르개로 사라진 칸이면 시트를 닫는다(누른 칸을 비움)", () => {
    const s = callReducer(sel, { type: "toggleBand", band: "evening" });
    expect(s.selected).toBeNull();
    expect(callView(input, s).sheet).toBeNull();
  });
});
