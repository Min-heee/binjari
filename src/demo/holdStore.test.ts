import { describe, expect, it } from "vitest";
import { localDate } from "@/core/calendar";
import { DEMO_NOW, DEMO_NOW_MS } from "./clock";
import { mustDemo } from "./data";
import { addHold, HOLDS_KEY, parseHoldsRaw, removeHold, serializeHolds } from "./holdStore";

/** 가예약 저장값(localStorage)의 모양. 틀리면 일부만 살리지 않고 모두 버린다(PRD F7). */

const { engine } = mustDemo();
const D = localDate;

describe("가예약 저장", () => {
  it("키는 판 번호를 단다", () => {
    expect(HOLDS_KEY).toBe("binjari.holds.v1");
  });
  it("더하고 → 글자로 → 다시 읽으면 같다. 시각은 기준 시각, 전화번호 모양은 가림", () => {
    const { holds, hold } = addHold([], { service: "first-consult", date: D("2026-09-22"), start: "14:00", nowMs: DEMO_NOW_MS, memo: "010-1234-5678 오후" });
    expect(hold.createdAt).toBe(DEMO_NOW);
    expect(hold.memo).not.toContain("1234");
    expect(parseHoldsRaw(serializeHolds(holds), engine)).toEqual({ holds, dropped: null });
  });
  it("같은 칸을 두 번 누르면 쌓지 않고 바꾼다(ID가 겹쳐 다음에 전부 버려지지 않게)", () => {
    const a = addHold([], { service: "injection", date: D("2026-09-21"), start: "11:00", nowMs: DEMO_NOW_MS });
    const b = addHold(a.holds, { service: "injection", date: D("2026-09-21"), start: "11:00", nowMs: DEMO_NOW_MS, memo: "다시" });
    expect(b.holds).toHaveLength(1);
    expect(b.holds[0].memo).toBe("다시");
    expect(parseHoldsRaw(serializeHolds(b.holds), engine).dropped).toBeNull();
  });
  it("되돌리기는 그 가예약만 뺀다", () => {
    const a = addHold([], { service: "injection", date: D("2026-09-21"), start: "11:00", nowMs: DEMO_NOW_MS });
    const b = addHold(a.holds, { service: "first-consult", date: D("2026-09-22"), start: "14:00", nowMs: DEMO_NOW_MS });
    expect(removeHold(b.holds, a.hold.id)).toEqual([b.hold]);
  });
  it("비었으면 없음, 모양이 틀리면 모두 버리고 까닭", () => {
    expect(parseHoldsRaw(null, engine)).toEqual({ holds: [], dropped: null });
    expect(parseHoldsRaw("{", engine).dropped).toBe("저장값을 읽을 수 없습니다");
    expect(parseHoldsRaw("[]", engine).dropped).toBe("저장값 모양이 틀렸습니다");
    expect(parseHoldsRaw(JSON.stringify({ v: 2, holds: [] }), engine).dropped).toBe("저장값 판이 다릅니다");
    const good = addHold([], { service: "injection", date: D("2026-09-21"), start: "11:00", nowMs: DEMO_NOW_MS }).holds;
    const bad = JSON.stringify({ v: 1, holds: [...good, { ...good[0], id: "x", service: "surgery-anything" }] });
    const r = parseHoldsRaw(bad, engine);
    expect(r.holds).toEqual([]);
    expect(r.dropped).toContain("모르는 안건");
  });
});
