import { describe, expect, it } from "vitest";
import { addDays, checkDay, dayOfWeek, diffDays, formatHhmm, formatShort, kstDateOf, kstMinuteOfDay, localDate, parseClinicHours, parseInstant } from "./calendar";
import { engine } from "./__fixtures__/load";

/** 다시봄에서 가져온 KST 날짜 산술(PRD F3)과, 이 저장소가 더한 V02 점심·접수 마감·수술 없는 요일 읽기. */

const E = engine();
const D = localDate;

describe("KST 날짜", () => {
  it("요일·날짜 더하기는 실행 환경 시간대와 상관없다", () => {
    expect(dayOfWeek(D("2026-09-21"))).toBe(1);
    expect(addDays(D("2026-09-30"), 1)).toBe("2026-10-01");
    expect(diffDays(D("2026-09-21"), D("2026-09-28"))).toBe(7);
    expect(formatShort(D("2026-10-03"))).toBe("10/3(토)");
  });
  it("자정 근처 시각의 KST 날짜(UTC 날짜가 아님)", () => {
    expect(kstDateOf(parseInstant("2026-09-21T00:30:00+09:00"))).toBe("2026-09-21");
    expect(kstDateOf(parseInstant("2026-09-20T15:30:00Z"))).toBe("2026-09-21");
    expect(kstMinuteOfDay(parseInstant("2026-09-20T15:30:00Z"))).toBe(30);
  });
  it("시간대 없는 시각·달력에 없는 날은 거부한다", () => {
    expect(() => parseInstant("2026-09-21T10:00")).toThrow();
    expect(() => localDate("2026-02-30")).toThrow();
  });
  it("formatHhmm", () => {
    expect(formatHhmm(0)).toBe("00:00");
    expect(formatHhmm(18 * 60 + 30)).toBe("18:30");
    expect(() => formatHhmm(1440)).toThrow();
  });
});

describe("진료일 판정(V02 + B02)", () => {
  it.each([
    ["2026-09-23", true, []],
    ["2026-09-24", false, ["추석 연휴"]],
    ["2026-09-25", false, ["추석"]],
    ["2026-09-27", false, ["일요일 휴진"]],
    ["2026-10-05", false, ["공휴일(대체공휴일(개천절))"]],
    ["2026-10-10", true, []],
    ["2026-10-16", false, ["휴진(내부 교육)"]],
  ])("%s", (d, open, labels) => {
    const c = checkDay(D(d), E.calendar);
    expect(c.open).toBe(open);
    expect(c.reasons.map((r) => (r.kind === "holiday" && (r.name === "추석 연휴" || r.name === "추석") ? r.name : r.label))).toEqual(labels);
  });
  it("확인 범위 밖은 holidayUnknown", () => {
    expect(checkDay(D("2027-12-31"), E.calendar).holidayUnknown).toBe(false);
    expect(checkDay(D("2028-01-03"), E.calendar).holidayUnknown).toBe(true);
  });
});

describe("V02 점심·접수 마감·수술 없는 요일", () => {
  const base = {
    timezone: "Asia/Seoul",
    weekly: { mon: { open: "10:00", close: "19:00" }, tue: { open: "10:00", close: "19:00" }, wed: { open: "10:00", close: "19:00" }, thu: { open: "10:00", close: "21:00" }, fri: { open: "10:00", close: "19:00" }, sat: { open: "10:00", close: "15:00" }, sun: null },
    lunch: { start: "13:00", end: "14:00", days: ["mon", "tue", "wed", "thu", "fri"] },
    lastEntryMinutesBeforeClose: 30,
    closed: ["sun", "public-holiday"],
    extraClosedDates: [],
    noSurgeryDays: ["sat"],
  };
  it("읽는다", () => {
    const r = parseClinicHours(base);
    expect(r.ok && [r.hours.lastEntryMinutesBeforeClose, r.hours.noSurgeryDays]).toEqual([30, ["sat"]]);
  });
  it.each([
    ["점심 시각 거꾸로", { lunch: { ...base.lunch, start: "14:00", end: "13:00" } }, "V02 lunch 시각이 틀렸습니다: 14:00~13:00"],
    ["점심 키 빠짐", { lunch: { start: "13:00", end: "14:00" } }, "V02 lunch는 { start, end, days }여야 합니다"],
    ["접수 마감 없음", { lastEntryMinutesBeforeClose: undefined }, "V02 lastEntryMinutesBeforeClose는 0~180 정수여야 합니다: undefined"],
    ["수술 없는 요일 오타", { noSurgeryDays: ["saturday"] }, "V02 noSurgeryDays가 요일 배열이 아닙니다"],
  ])("%s → 거부", (_, patch, err) => {
    const r = parseClinicHours({ ...base, ...patch });
    expect(r.ok ? [] : r.errors).toEqual([err]);
  });
});
