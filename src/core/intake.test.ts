import { describe, expect, it } from "vitest";
import { engine } from "./__fixtures__/load";
import { questionFor, resolveIntake } from "./intake";

/** 안건 버튼 → 확인 질문 → 찾을 안건(PRD 3절 표). */

const E = engine();
const r = (button: string, answer: string, sub?: string, size?: string) => {
  const x = resolveIntake(E, { button, answer, ...(sub ? { sub } : {}), ...(size ? { size } : {}) });
  if (!x.ok) throw new Error(x.error);
  return x.resolved;
};

describe("버튼 셋과 질문", () => {
  it("버튼은 상담·시술·재시술, 재시술 밑에 고객 말", () => {
    expect(E.rules.intake.map((b) => b.label)).toEqual(["상담", "시술", "재시술"]);
    expect(E.rules.intake[2].hint).toBe("보강 · 추가 이식 · 재수술");
    expect(E.rules.scopeLine).toBe("예약 변경·수술 후 경과 진료 → 예약표에서 확인(이 도구 밖)");
  });
  it("질문", () => {
    expect(questionFor(E, "consult")?.question).toBe("처음 오시나요?");
    expect(questionFor(E, "procedure", "surgery")?.question).toBe("첫 상담을 받으셨나요?");
    expect(questionFor(E, "procedure", "injection")?.question).toBe("어떤 주사 예약인가요?");
    expect(questionFor(E, "procedure", "scalp-care")?.question).toBe("처음이세요?");
    expect(questionFor(E, "retouch")?.question).toBe("여기서 수술 받으셨나요?");
    expect(questionFor(E, "procedure")).toBeNull();
  });
});

describe("대답 → 안건", () => {
  it("상담: 처음 → 첫 상담, 재진 → 의료진 재진 상담", () => {
    expect(r("consult", "first")).toMatchObject({ service: "first-consult", redirect: null, mode: "search" });
    expect(r("consult", "returning")).toMatchObject({ service: "revisit-consult", redirect: null });
  });
  it("수술: 상담 안 받음 → 첫 상담으로 바뀜(까닭), 받음 → 하루(기본값), 반나절 고를 수 있음", () => {
    expect(r("procedure", "no", "surgery")).toMatchObject({ service: "first-consult", redirect: "처음 오시는 분은 첫 상담부터(V05)" });
    const yes = r("procedure", "yes", "surgery");
    expect(yes).toMatchObject({ service: "surgery-full", redirect: null });
    expect(yes.sizes.map((s) => s.key)).toEqual(["surgery-full", "surgery-half"]);
    expect(r("procedure", "yes", "surgery", "surgery-half").service).toBe("surgery-half");
    expect(resolveIntake(E, { button: "procedure", sub: "surgery", answer: "yes", size: "injection" }).ok).toBe(false);
  });
  it("주사: 처음 → 첫 상담, 시작·다음 회차 → 주사(진찰 뒤에만), 회차 옮기기 → 창 모드", () => {
    expect(r("procedure", "new", "injection")).toMatchObject({ service: "first-consult", redirect: "처음 오시는 분은 첫 상담부터(V05·V08)" });
    expect(r("procedure", "start", "injection")).toMatchObject({ service: "injection", mode: "search", notes: ["첫 회차는 진찰 뒤에만(V08)"] });
    expect(r("procedure", "move", "injection")).toMatchObject({ service: "injection", mode: "move" });
  });
  it("관리: 처음 → 첫 상담, 아니오 → 두피 관리(안내 둘)", () => {
    expect(r("procedure", "first", "scalp-care")).toMatchObject({ service: "first-consult", redirect: "처음 오시는 분은 첫 상담부터(V05)" });
    expect(r("procedure", "returning", "scalp-care").notes).toEqual(["수술 받은 분은 4주 경과 진료 확인 뒤부터, 주사 당일 불가(V09)", "두피 상태가 걱정되면 정밀 진단 안내(V09·V03)"]);
  });
  it("재시술: 여기서 → 의료진 재진 상담(집도 의료진 안내), 다른 병원 → 첫 상담", () => {
    const here = r("retouch", "here");
    expect(here.service).toBe("revisit-consult");
    expect(here.notes[0]).toBe("담당(집도) 의료진 일정은 예약표에서 확인");
    expect(here.answerNotes).toEqual(["담당(집도) 의료진 일정은 예약표에서 확인"]);
    expect(here.serviceNotes).toEqual(["바로 수술 아님 — 의료진 상담 뒤 수술은 '시술 → 모발이식 수술'로 잡음"]);
    expect(here.hint).toBe("보강 · 추가 이식 · 재수술");
    expect(r("retouch", "elsewhere")).toMatchObject({ service: "first-consult", redirect: "다른 병원에서 수술 받은 분은 첫 상담부터[가정]" });
  });
  it("모르는 버튼·대답·하위 선택 없음은 오류", () => {
    expect(resolveIntake(E, { button: "x", answer: "y" })).toEqual({ ok: false, error: "모르는 버튼입니다: x" });
    expect(resolveIntake(E, { button: "consult", answer: "y" })).toEqual({ ok: false, error: "모르는 대답입니다: y" });
    expect(resolveIntake(E, { button: "procedure", answer: "yes" })).toEqual({ ok: false, error: "하위 선택을 고르세요: 모발이식 수술 · 두피 주사 · 두피 관리" });
  });
});
