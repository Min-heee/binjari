import { describe, expect, it } from "vitest";
import { localDate } from "./calendar";
import { EMPTY, engine, NOW, TODAY } from "./__fixtures__/load";
import { makeHold } from "./holds";
import { accountNote, composeClosed, composeConfirmation, composeHoldLine, composeReadout, fillTemplate, formatWon, readDate, readTime } from "./message";
import { findSlots, suggestSlots, type Slot } from "./slots";

/** 읽어 줄 안내 문장·확정 문자·옮길 한 줄(PRD F6·F7). 틀에 칸만 채운다. */

const E = engine();
const D = localDate;

function slots(service: string, nowMs = NOW): Slot[] {
  const r = findSlots(E, { service, nowMs, schedule: EMPTY });
  if (!r.ok) throw new Error(r.errors.join());
  return suggestSlots(E, r.slots);
}

describe("시각·날짜 읽기", () => {
  it.each([
    ["10:00", "오전 10시"],
    ["10:30", "오전 10시 30분"],
    ["11:30", "오전 11시 30분"],
    ["12:00", "낮 12시"],
    ["12:30", "낮 12시 30분"],
    ["14:00", "오후 2시"],
    ["20:30", "오후 8시 30분"],
  ])("%s → %s", (t, s) => expect(readTime(t)).toBe(s));
  it.each([
    ["17:30", "오후 5시 30분"],
    ["18:00", "저녁 6시"],
    ["20:30", "저녁 8시 30분"],
  ])("저녁 경계(B01 bands.eveningFrom 18:00): %s → %s", (t, s) => expect(readTime(t, "18:00")).toBe(s));

  it("오늘·내일·모레를 날짜 앞에 붙이고 요일을 함께 읽는다", () => {
    expect(readDate(TODAY, D("2026-09-21"))).toBe("오늘 9월 21일 월요일");
    expect(readDate(TODAY, D("2026-09-22"))).toBe("내일 9월 22일 화요일");
    expect(readDate(TODAY, D("2026-09-23"))).toBe("모레 9월 23일 수요일");
    expect(readDate(TODAY, D("2026-09-28"))).toBe("9월 28일 월요일");
  });
  it("금액", () => expect([formatWon(30000), formatWon(500000), formatWon(0)]).toEqual(["30,000원", "500,000원", "0원"]));
});

describe("읽어 줄 안내 문장", () => {
  it("첫 상담: 오늘·같은 날 두 칸 + 가까운 날짜 문장 + V04 확정 조건", () => {
    const r = composeReadout(E, { service: "first-consult", slots: slots("first-consult"), today: TODAY });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.lines).toEqual([
      "지금 비어 있는 시간을 말씀드릴게요.",
      "오늘 9월 21일 월요일 오전 11시, 또는 같은 날 낮 12시에 자리가 있습니다.",
      "첫 상담은 진단을 포함해 약 60분 걸리고, 대기 시간이 생길 수 있어 여유 있게 오시면 됩니다.",
      "예약금은 30,000원이고, 방문하시면 상담비로 전환됩니다.",
      "가까운 날짜라 입금을 바로 확인해야 하고, 확정 연락(카카오 채널이나 문자)을 드려야 예약이 확정됩니다.",
    ]);
    // 입금 계좌 자리표시는 읽는 문장에 섞지 않는다(화면이 따로 보인다).
    expect(r.text).not.toContain("예약 프로그램 문구");
    expect(r.ad.level).toBe("clean");
  });

  it("가까운 날짜가 아니면 '1영업일 안에 확정 연락' — 확정 조건은 한 문장", () => {
    const later = findSlots(E, { service: "first-consult", nowMs: NOW, schedule: EMPTY });
    if (!later.ok) throw new Error();
    const far = later.slots.filter((x) => x.date >= D("2026-09-28")).slice(0, 1);
    const r0 = composeReadout(E, { service: "first-consult", slots: far, today: TODAY });
    if (!r0.ok) throw new Error(r0.errors.join());
    expect(r0.lines.at(-1)).toBe("예약금 입금을 확인하면 1영업일 안에 확정 연락(카카오 채널이나 문자)을 드리고, 그때 예약이 확정됩니다.");
    expect(r0.lines.filter((l) => l.includes("확정")).length).toBe(1);
  });

  it("수술: 입금과 의료진 확인을 한 문장으로", () => {
    const r = composeReadout(E, { service: "surgery-full", slots: slots("surgery-full"), today: TODAY });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.lines).toEqual([
      "지금 비어 있는 시간을 말씀드릴게요.",
      "9월 28일 월요일 오전 10시, 또는 9월 29일 화요일 오전 10시에 자리가 있습니다.",
      "수술 다음 날에도 내원하셔야 합니다.",
      "수술 예약금은 500,000원이고, 수술비에 포함됩니다.",
      "예약금 입금과 의료진 일정 확인이 끝나면 확정 연락(카카오 채널이나 문자)을 드리고, 수술 전 검사 날짜는 따로 안내드립니다.",
    ]);
  });

  it("예약금 없는 안건(재진·주사)은 예약금·입금 문장 없이 확정 연락 조건만", () => {
    for (const s of ["revisit-consult", "injection"]) {
      const r = composeReadout(E, { service: s, slots: slots(s), today: TODAY });
      if (!r.ok) throw new Error(r.errors.join());
      expect(r.text).not.toMatch(/예약금|입금/);
      expect(r.lines.at(-1)).toBe("확정 연락(카카오 채널이나 문자)을 드려야 예약이 확정됩니다.");
    }
  });

  it("칸 하나면 한 칸 문장", () => {
    const r = composeReadout(E, { service: "injection", slots: slots("injection").slice(0, 1), today: TODAY });
    expect(r.ok && r.lines[1]).toBe("오늘 9월 21일 월요일 오전 11시에 자리가 있습니다.");
  });

  it("모든 안건 문장에 '가예약'이 없고, 채우지 못한 칸이 없고, 광고 표현이 없다", () => {
    for (const s of ["first-consult", "revisit-consult", "injection", "scalp-care", "surgery-full", "surgery-half"]) {
      const r = composeReadout(E, { service: s, slots: slots(s), today: TODAY });
      if (!r.ok) throw new Error(r.errors.join());
      expect(r.text, s).not.toContain("가예약");
      expect(r.text, s).not.toMatch(/\{\{|\}\}/);
      expect(r.ad.level, s).toBe("clean");
      expect(r.lines[0], s).toBe("지금 비어 있는 시간을 말씀드릴게요.");
    }
  });

  it("칸이 없거나 모르는 안건이면 만들지 않는다", () => {
    expect(composeReadout(E, { service: "injection", slots: [], today: TODAY })).toEqual({ ok: false, errors: ["제안할 빈 시간이 없습니다"] });
    expect(composeReadout(E, { service: "postop-visit", slots: slots("injection"), today: TODAY }).ok).toBe(false);
  });
});

describe("확정 문자(사람이 입금 확인 뒤 보냄)", () => {
  it("첫 상담", () => {
    const r = composeConfirmation(E, { service: "first-consult", date: D("2026-09-22"), start: "10:30" });
    expect(r.ok && r.text).toBe(
      "안녕하세요, 샘플의원입니다. 9월 22일(화) 오전 10시 30분 첫 상담 예약이 확정되었습니다. 상담은 진단을 포함해 약 60분 걸립니다. 복용 중인 약과 영양제 이름을 적어 오시고, 머리를 감고 스타일링 제품 없이 와 주세요. 예약 변경은 방문 1일 전 오후 6시까지 할 수 있습니다. 문의는 02-000-0000으로 해 주세요. 감사합니다.",
    );
  });
  it("수술은 다음 날 내원일을 채운다", () => {
    const r = composeConfirmation(E, { service: "surgery-half", date: D("2026-09-28"), start: "14:30" });
    expect(r.ok && r.text).toContain("9월 28일(월) 오후 2시 30분 모발이식 수술 일정이 확정되었습니다. 수술 다음 날 9월 29일(화)에도 내원하셔야 합니다.");
  });
  it("모든 안건의 확정 문자가 광고 표현 검사를 통과한다", () => {
    for (const s of ["first-consult", "revisit-consult", "injection", "scalp-care", "surgery-full", "surgery-half"]) {
      const r = composeConfirmation(E, { service: s, date: D("2026-09-28"), start: "10:00" });
      expect(r.ok && r.ad.level, s).toBe("clean");
    }
  });
});

describe("예약 프로그램에 옮길 한 줄", () => {
  it("날짜·시각·안건·풀리는 시각·메모(가림)", () => {
    const h = makeHold({ service: "first-consult", date: D("2026-09-28"), start: "10:00", createdAt: "2026-09-21T10:00:00+09:00", memo: "010 1234 5678 오후 선호" });
    const r = composeHoldLine(E, h);
    expect(r.ok && r.text).toBe("2026-09-28(월) 10:00~11:00 첫 상담 · 입금 대기(빈자리 가예약, 9/22(화) 19:00까지) · 메모: [전화] 오후 선호");
  });
  it("메모가 없으면 '-'", () => {
    const h = makeHold({ service: "injection", date: D("2026-09-22"), start: "18:30", createdAt: "2026-09-21T10:00:00+09:00" });
    expect(composeHoldLine(E, h)).toMatchObject({ ok: true, text: "2026-09-22(화) 18:30~19:00 두피 주사 · 확정 연락 대기(빈자리 가예약, 9/22(화) 18:30까지) · 메모: -" });
  });
});

describe("휴진 줄 문장(추석 문의)", () => {
  it("하루짜리 휴진, 뒤에 빈 시간이 없으면 휴진 사유만", () => {
    expect(composeClosed(E, { from: D("2026-10-09"), to: D("2026-10-09"), reason: "한글날", next: null, today: TODAY })).toMatchObject({ ok: true, text: "10월 9일 금요일은 휴진입니다(한글날)." });
  });
  it("여러 날 휴진 + 가장 가까운 빈 시간(저녁은 '저녁 8시')", () => {
    const r = composeClosed(E, { from: D("2026-09-22"), to: D("2026-09-23"), reason: "시험", next: { date: D("2026-10-01"), start: "20:00" }, today: TODAY });
    expect(r.ok && r.text).toBe("내일 9월 22일 화요일부터 모레 9월 23일 수요일까지는 휴진입니다(시험). 가장 가까운 빈 시간은 10월 1일 목요일 저녁 8시입니다.");
  });
  it("입금 안내 자리표시는 예약금 안건에만", () => {
    expect(accountNote(E, "first-consult")).toBe("입금 안내는 예약 프로그램 문구 사용");
    expect(accountNote(E, "surgery-half")).toBe("입금 안내는 예약 프로그램 문구 사용");
    expect(accountNote(E, "injection")).toBeNull();
    expect(accountNote(E, "revisit-consult")).toBeNull();
  });
});

describe("fillTemplate", () => {
  it("없는 칸·모르는 칸은 오류", () => {
    expect(fillTemplate("{{date}} {{time}}", { date: "9/22" })).toEqual({ ok: false, errors: ["칸 값이 없습니다: {{time}}"] });
    expect(fillTemplate("{{name}}", {})).toEqual({ ok: false, errors: ["모르는 칸입니다: {{name}}"] });
    expect(fillTemplate("{{ date }}!", { date: "9/22" })).toEqual({ ok: true, text: "9/22!" });
  });
});
