import { describe, expect, it } from "vitest";
import { localDate } from "./calendar";
import { at, EMPTY, engine, engineWithB01, NOW } from "./__fixtures__/load";
import { cleanMemo, formatExpiry, holdExpiryMs, holdState, liveHolds, makeHold, nextBusinessDay, parseStoredHolds } from "./holds";
import { checkSlot, findSlots } from "./slots";

/** 가예약(PRD F7): 입금 기한까지 유지, 시연 시계로 판단, 모든 안건 계산에서 자원·하루 최대를 차지. */

const E = engine();
const D = localDate;
const hold = (date: string, start: string, createdAt = "2026-09-21T10:00:00+09:00", service = "first-consult") =>
  makeHold({ service, date: D(date), start, createdAt });

describe("유지 기간 — 가예약한 날의 다음 영업일 진료 종료, 칸 시작을 넘지 않음", () => {
  it("9/21(월) 10:00에 잡은 9/28 칸 → 9/22(화) 19:00", () => {
    expect(holdExpiryMs(E, hold("2026-09-28", "10:00"))).toBe(at("2026-09-22T19:00"));
    expect(formatExpiry(E, hold("2026-09-28", "10:00"))).toBe("9/22(화) 19:00");
  });
  it("오늘 칸이면 칸 시작 시각에 풀린다(9/21 14:00 칸 → 9/21 14:00)", () => {
    expect(holdExpiryMs(E, hold("2026-09-21", "14:00"))).toBe(at("2026-09-21T14:00"));
  });
  it("추석 전날(9/23)에 잡으면 연휴를 건너 9/28(월) 19:00", () => {
    expect(holdExpiryMs(E, hold("2026-10-01", "10:00", "2026-09-23T15:00:00+09:00"))).toBe(at("2026-09-28T19:00"));
  });
  it("다음 영업일이 목요일이면 21:00(9/30 → 10/1)", () => {
    expect(holdExpiryMs(E, hold("2026-10-06", "10:00", "2026-09-30T11:00:00+09:00"))).toBe(at("2026-10-01T21:00"));
  });
  it("토요일도 영업일이다(10/8 → 10/10 15:00). 규칙을 바꾸면 10/12로", () => {
    expect(nextBusinessDay(E, D("2026-10-08"))).toBe("2026-10-10");
    expect(holdExpiryMs(E, hold("2026-10-20", "10:00", "2026-10-08T11:00:00+09:00"))).toBe(at("2026-10-10T15:00"));
    const noSat = engineWithB01((j) => {
      j.businessDaysIncludeSaturday = false;
    });
    expect(nextBusinessDay(noSat, D("2026-10-08"))).toBe("2026-10-12");
  });
});

describe("상태 — 시연 시계로 판단(앞으로 옮기면 풀리고 되돌리면 다시 보인다)", () => {
  const h = hold("2026-09-28", "10:00");
  it.each([
    ["2026-09-21T09:59", "not-yet"],
    ["2026-09-21T10:00", "alive"],
    ["2026-09-22T17:59", "alive"],
    ["2026-09-22T18:00", "expiring"],
    ["2026-09-22T18:59", "expiring"],
    ["2026-09-22T19:00", "expired"],
  ])("%s → %s", (now, state) => expect(holdState(E, h, at(now))).toBe(state));

  it("살아 있는 가예약만 계산에 들어간다", () => {
    expect(liveHolds(E, [h], at("2026-09-22T18:30"))).toEqual([h]);
    expect(liveHolds(E, [h], at("2026-09-22T19:00"))).toEqual([]);
  });

  it("기준 시각 왕복: 풀렸다가 다시 차지한다", () => {
    const h1 = makeHold({ service: "scalp-care", date: D("2026-09-28"), start: "10:00", createdAt: "2026-09-21T10:00:00+09:00" });
    const c = (now: string) => checkSlot(E, { service: "scalp-care", nowMs: at(now), schedule: EMPTY, holds: [h1] }, D("2026-09-28"), "10:00").reasons;
    expect(c("2026-09-21T10:00")).toEqual(["held"]);
    expect(c("2026-09-22T19:00")).toEqual([]);
    expect(c("2026-09-21T10:00")).toEqual(["held"]);
    expect(c("2026-09-21T09:00")).toEqual([]);
  });
});

describe("가예약은 모든 안건 계산에서 자원을 차지한다", () => {
  it("첫 상담 가예약 둘이 상담실·의료진을 차지해 같은 시각 재진 상담이 안 된다", () => {
    const hs = [hold("2026-09-28", "10:00"), hold("2026-09-28", "10:00", "2026-09-21T09:55:00+09:00")];
    const r = checkSlot(E, { service: "revisit-consult", nowMs: NOW, schedule: EMPTY, holds: hs }, D("2026-09-28"), "10:00");
    expect(r.reasons).toEqual(["held"]);
    // 두 가예약이 상담실 2개(10:00~11:00)와 의료진 2명(10:20~10:40)을 모두 쓴다.
    expect(r.short).toEqual(["consultRoom", "doctor"]);
  });
  it("가예약한 칸은 목록에서 빠진다(관리실 1)", () => {
    const h = makeHold({ service: "scalp-care", date: D("2026-09-22"), start: "10:00", createdAt: "2026-09-21T10:00:00+09:00" });
    const r = findSlots(E, { service: "scalp-care", nowMs: NOW, schedule: EMPTY, holds: [h] });
    if (!r.ok) throw new Error();
    expect(r.slots.filter((s) => s.date === "2026-09-22").map((s) => s.start).slice(0, 3)).toEqual(["11:00", "11:30", "12:00"]);
  });
});

describe("저장값 검증 — 틀리면 모두 버린다", () => {
  const good = [hold("2026-09-28", "10:00")];
  it("없으면 빈 목록", () => expect(parseStoredHolds(null, E)).toEqual({ holds: [], discarded: false }));
  it("맞는 값은 그대로", () => expect(parseStoredHolds(JSON.parse(JSON.stringify(good)), E)).toEqual({ holds: good, discarded: false }));
  it.each([
    ["배열 아님", { a: 1 }],
    ["키 더 있음", [{ ...good[0], name: "홍길동" }]],
    ["모르는 안건", [{ ...good[0], service: "nope" }]],
    ["버튼으로 잡지 않는 안건", [{ ...good[0], service: "postop-visit" }]],
    ["시간대 없는 시각", [{ ...good[0], createdAt: "2026-09-21T10:00" }]],
    ["달력에 없는 날", [{ ...good[0], date: "2026-02-30" }]],
    ["ID 겹침", [good[0], good[0]]],
    ["하나만 틀려도", [good[0], { ...good[0], id: "x", start: "25:00" }]],
  ])("%s → 모두 버림", (_, raw) => {
    const r = parseStoredHolds(raw, E);
    expect(r.discarded).toBe(true);
    expect(r.holds).toEqual([]);
  });
});

describe("메모 칸 — 전화번호 모양은 가린다", () => {
  it("전화·이메일을 가리고 80자로 자른다", () => {
    expect(cleanMemo(" 010-1234-5678 로 다시 전화 ")).toBe("[전화] 로 다시 전화");
    expect(cleanMemo("a".repeat(100))).toHaveLength(80);
    expect(makeHold({ service: "injection", date: D("2026-09-22"), start: "10:00", createdAt: "2026-09-21T10:00:00+09:00", memo: "문의 me@example.com" }).memo).toBe("문의 [이메일]");
  });
  it("가림 표시로 글이 늘어도 80자를 넘지 않고, 저장값으로 다시 읽힌다", () => {
    // 화면 입력칸 maxLength=80 안의 메모. "민수"(2자)가 "[이름]"(4자)으로 늘어난다.
    const memo = "민수님 ".repeat(20).slice(0, 80);
    const h = makeHold({ service: "injection", date: D("2026-09-22"), start: "10:00", createdAt: "2026-09-21T10:00:00+09:00", memo });
    expect(h.memo.length).toBeLessThanOrEqual(80);
    expect(parseStoredHolds([h], E)).toEqual({ holds: [h], discarded: false });
  });
  it("80자 끝에 걸친 전화번호도 일부가 남지 않게 가린다", () => {
    const m = cleanMemo(`${"x".repeat(72)}01012345678`);
    expect(m).not.toMatch(/\d{4}/);
  });
});
