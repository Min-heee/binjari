import { describe, expect, it } from "vitest";
import { localDate } from "./calendar";
import { loadEngine } from "./engine";
import { EMPTY, engineWithB01, NOW, TODAY, vaultWith } from "./__fixtures__/load";
import { findSlots, firstBookable } from "./slots";

/**
 * 변이 시험(2026-09-30)에서 살아남은 결함을 잡는 시험.
 * 시연 규칙 값(slotMinutes 30, leadMinutes 60)으로만 시험하면 "값을 코드에 박아 둔" 결함이 그대로 통과한다(M39·M40).
 * 그래서 B01 값을 바꾼 엔진으로, 값이 실제로 계산에 들어가는지 본다.
 */

const D = (s: string) => localDate(s);

function okSlots(r: ReturnType<typeof findSlots>) {
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r;
}

describe("변이 M27 — json 코드블록이 둘이면 멈춘다", () => {
  it("B01에 옛 값 json 블록이 하나 더 붙으면 첫 블록을 쓰지 않고 멈춘다", () => {
    const files = vaultWith("vault/booking-slots.md", (raw) => `${raw}\n\n## 옛 값\n\n\`\`\`json\n{ "slotMinutes": 15 }\n\`\`\`\n`);
    const r = loadEngine(files, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/B01: json 코드블록이 2개입니다/);
  });
});

describe("변이 M39 — slotMinutes는 B01에서 읽는다", () => {
  it("slotMinutes를 20으로 바꾸면 격자가 10:00·10:20·10:40…이 된다(9/22 주사, 빈 예약표)", () => {
    const e = engineWithB01((j) => (j.slotMinutes = 20));
    const r = okSlots(findSlots(e, { service: "injection", nowMs: NOW, schedule: EMPTY }));
    const day = r.days.find((d) => d.date === D("2026-09-22"))!;
    expect(day.candidates.slice(0, 4).map((c) => c.start)).toEqual(["10:00", "10:20", "10:40", "11:00"]);
    expect(day.slots.map((s) => s.start)).toContain("10:20");
  });
});

describe("접수 마감(④)이 격자에서 실제로 걸리는 경우(M04 보강)", () => {
  it("10분 격자 + 20분 안건이면 18:40은 19:00에 끝나도 접수 마감 뒤라 안 된다", () => {
    const e = engineWithB01((j) => {
      j.slotMinutes = 10;
      const inj = (j.services as Record<string, Record<string, unknown>>).injection;
      inj.minutes = 20;
      inj.phases = [
        { from: 0, to: 10, use: { doctor: 1 } },
        { from: 0, to: 20, use: { nurse: 1, treatmentRoom: 1 } },
      ];
    });
    const r = okSlots(findSlots(e, { service: "injection", nowMs: NOW, schedule: EMPTY }));
    const day = r.days.find((d) => d.date === D("2026-09-22"))!;
    expect(day.slots.at(-1)!.start).toBe("18:30");
    expect(day.candidates.find((c) => c.start === "18:40")!.reasons).toEqual(["after-last-entry"]);
  });
});

describe("변이 M40 — leadMinutes는 B01에서 읽는다", () => {
  it("leadMinutes를 120으로 바꾸면 9/21 10:00 전화의 첫 예약 가능 시각은 12:00", () => {
    const e = engineWithB01((j) => (j.leadMinutes = 120));
    expect(firstBookable(e, NOW)).toEqual({ date: D("2026-09-21"), time: "12:00" });
    const r = okSlots(findSlots(e, { service: "injection", nowMs: NOW, schedule: EMPTY }));
    const today = r.days.find((d) => d.date === D("2026-09-21"))!;
    expect(today.candidates.find((c) => c.start === "11:30")!.reasons).toContain("before-earliest");
    expect(today.slots[0].start).toBe("12:00");
  });
});
