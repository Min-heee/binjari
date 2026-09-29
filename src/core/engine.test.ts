import { describe, expect, it } from "vitest";
import { loadEngine } from "./engine";
import { parseRules } from "./rules";
import { TODAY, vaultFiles, vaultWith } from "./__fixtures__/load";

/**
 * 규칙 읽기(PRD F2): 볼트 문서 json에서만 읽고, 깨지거나 빠지면 **멈춘다**(기본값을 채우지 않는다).
 * B01만 draft + assumption 예외.
 */

const load = (files = vaultFiles()) => loadEngine(files, TODAY);

function b01(edit: (j: Record<string, unknown>) => void) {
  return vaultWith("vault/booking-slots.md", (raw) => {
    const m = /```json\n([\s\S]*?)\n```/.exec(raw)!;
    const j = JSON.parse(m[1]) as Record<string, unknown>;
    edit(j);
    return raw.replace(m[1], JSON.stringify(j, null, 2));
  });
}

function errorsOf(files: { path: string; raw: string }[]): string[] {
  const r = load(files);
  if (r.ok) throw new Error("멈춰야 하는데 엔진이 만들어졌습니다");
  return r.errors;
}

const svc = (j: Record<string, unknown>) => j.services as Record<string, Record<string, unknown>>;

describe("정상 볼트", () => {
  it("엔진을 만들고, B01이 [가정] 문서라고 표시한다", () => {
    const r = load();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.engine.assumptionRules).toBe(true);
      expect(r.engine.calendar.holidays.find((h) => h.date === "2026-09-25")?.name).toBe("추석");
      expect(r.engine.hours.lunch).toEqual({ start: "13:00", end: "14:00", days: ["mon", "tue", "wed", "thu", "fri"] });
      expect(r.engine.prices["deposit-consult"].price).toBe(30000);
      expect(r.engine.holidaysCheckedOn).toBe("2026-09-28");
    }
  });
});

describe("문서의 지위", () => {
  it("B01이 assumption 없는 초안이면 멈춘다", () => {
    expect(errorsOf(vaultWith("vault/booking-slots.md", (r) => r.replace("assumption: true\n", "")))).toEqual(["B01: 승인된 문서가 없습니다"]);
  });
  it("B01이 승인 문서인데 assumption: true면 멈춘다(승인 값인지 [가정]인지 모름)", () => {
    expect(errorsOf(vaultWith("vault/booking-slots.md", (r) => r.replace("status: draft", "status: approved")))).toContain(
      "B01: 승인 문서에 assumption: true가 있습니다(승인 값인지 [가정]인지 알 수 없음)",
    );
  });
  it("병원이 B01을 승인하면(assumption 없이 approved) [가정] 띠가 꺼진다", () => {
    const r = load(vaultWith("vault/booking-slots.md", (x) => x.replace("status: draft", "status: approved").replace("assumption: true\n", "").replace("approvedBy: none", "approvedBy: 원무팀장")));
    expect(r.ok && r.engine.assumptionRules).toBe(false);
  });
  it("B01 말고 다른 문서는 draft + assumption이어도 받지 않는다(근거 문서 V05)", () => {
    const files = vaultWith("vault/consultation-guide.md", (r) => r.replace("status: approved", "status: draft\nassumption: true"));
    expect(errorsOf(files)).toEqual(["V05: 승인된 문서가 없습니다"]);
  });
  it("B02 공휴일이 초안이면 멈춘다", () => {
    expect(errorsOf(vaultWith("vault/holidays.md", (r) => r.replace("status: approved", "status: draft")))).toEqual(["B02: 승인된 문서가 없습니다"]);
  });
  it("V02가 없으면 멈춘다", () => {
    expect(errorsOf(vaultFiles().filter((f) => f.path !== "vault/hours-location.md"))).toEqual(["V02: 승인된 문서가 없습니다"]);
  });
  it("B01 시행일 전이면 멈춘다", () => {
    expect(loadEngine(vaultFiles(), "2026-08-31" as typeof TODAY).ok).toBe(false);
  });
});

describe("모양이 틀리면 멈춘다", () => {
  it("B01 json 문법 오류", () => {
    const errs = errorsOf(vaultWith("vault/booking-slots.md", (r) => r.replace('"slotMinutes": 30,', '"slotMinutes": 30')));
    expect(errs[0]).toMatch(/^B01: json을 읽을 수 없습니다/);
  });
  it.each([
    ["값 누락(leadMinutes)", (j: Record<string, unknown>) => delete j.leadMinutes, "B01: B01.leadMinutes가 없습니다"],
    ["모르는 키", (j: Record<string, unknown>) => (j.leadMinute = 60), "B01: B01 모르는 키입니다: leadMinute"],
    ["timezone", (j: Record<string, unknown>) => (j.timezone = "UTC"), "B01: timezone은 Asia/Seoul이어야 합니다: UTC"],
    ["칸 단위가 60을 나누지 않음", (j: Record<string, unknown>) => (j.slotMinutes = 25), "B01: slotMinutes는 60을 나누는 5~60 정수여야 합니다: 25"],
    ["자원 수량 빠짐", (j: Record<string, unknown>) => delete (j.capacity as { base: Record<string, number> }).base.nurse, "B01: capacity.base에 nurse 수량이 없습니다"],
    ["모르는 자원", (j: Record<string, unknown>) => ((svc(j)["injection"].phases as { use: Record<string, number> }[])[0].use = { robot: 1 }), "B01: services.injection.phases[0].use 모르는 자원입니다: robot"],
    ["단계가 소요 시간을 넘음", (j: Record<string, unknown>) => ((svc(j)["injection"].phases as { to: number }[])[1].to = 40), "B01: services.injection.phases[1] 구간이 틀렸습니다(0 ≤ from < to ≤ minutes): 0~40"],
    ["까닭 순서 빠짐", (j: Record<string, unknown>) => (j.reasonOrder as string[]).pop(), /^B01: reasonOrder는/],
    ["질문이 버튼으로 잡지 않는 안건을 가리킴", (j: Record<string, unknown>) => (((j.intake as { answers: { service: string }[] }[])[0].answers[0].service = "postop-visit")), "B01: intake[0].answers[0].service가 버튼으로 잡는 안건이 아닙니다: postop-visit"],
    ["문장 틀 빠짐", (j: Record<string, unknown>) => delete (j.templates as Record<string, string>)["confirm-injection"], "B01: templates.confirm-injection가 없습니다"],
    ["모르는 칸", (j: Record<string, unknown>) => ((j.templates as Record<string, string>)["readout-open"] = "{{name}}님, 말씀드릴게요."), "B01: templates.readout-open 모르는 칸입니다: {{name}}"],
    ["수술 시작 후보 순서", (j: Record<string, unknown>) => (svc(j)["surgery-half"].starts = ["14:30", "10:00"]), "B01: services.surgery-half.starts는 겹치지 않고 오름차순이어야 합니다"],
    ["하루 최대가 모르는 안건을 셈", (j: Record<string, unknown>) => ((j.dailyMax as { counts: string[] }[])[0].counts = ["consult"]), "B01: dailyMax[0].counts가 모르는 안건을 셉니다"],
  ])("%s", (_, edit, expected) => {
    const errs = errorsOf(b01(edit as (j: Record<string, unknown>) => void));
    if (typeof expected === "string") expect(errs).toContain(expected);
    else expect(errs.some((e) => expected.test(e)), errs.join("\n")).toBe(true);
  });

  it("예약금 키가 V03 가격표에 없으면 멈춘다", () => {
    expect(errorsOf(b01((j) => (svc(j)["scalp-care"].deposit = "deposit-scalp")))).toEqual(["B01: services.scalp-care.deposit deposit-scalp가 V03 가격표에 없습니다"]);
  });
  it("문장 틀에 광고 금지 표현·주의 표현이 있으면 멈춘다(V15)", () => {
    expect(errorsOf(b01((j) => ((j.templates as Record<string, string>)["readout-open"] = "효과 100% 보장 시간을 말씀드릴게요.")))[0]).toMatch(/^B01: templates.readout-open에 광고 표현이 있습니다/);
    expect(errorsOf(b01((j) => ((j.templates as Record<string, string>)["readout-open"] = "추천 시간을 말씀드릴게요.")))).toEqual(["B01: templates.readout-open에 광고 표현이 있습니다(추천)"]);
  });
  it("V02 점심이 진료시간 밖이거나 timezone이 틀리면 멈춘다", () => {
    expect(errorsOf(vaultWith("vault/hours-location.md", (r) => r.replace('"timezone": "Asia/Seoul"', '"timezone": "Asia/Tokyo"')))).toEqual(["V02 timezone은 Asia/Seoul이어야 합니다: Asia/Tokyo"]);
    expect(errorsOf(vaultWith("vault/hours-location.md", (r) => r.replace('"days": ["mon", "tue", "wed", "thu", "fri"]', '"days": ["mon", "sun"]')))).toEqual(["V02 lunch.days의 sun는 진료시간 안에 점심이 있어야 합니다"]);
  });
  it("B02 공휴일이 확인 기간 밖이거나 두 번 나오면 멈춘다", () => {
    expect(errorsOf(vaultWith("vault/holidays.md", (r) => r.replace('"date": "2026-09-24"', '"date": "2028-01-01"')))).toEqual(["B02 holidays[0] 2028-01-01가 확인 기간 밖입니다"]);
    expect(errorsOf(vaultWith("vault/holidays.md", (r) => r.replace('"date": "2026-09-24"', '"date": "2026-09-25"')))).toEqual(["B02 holidays에 같은 날짜가 두 번 있습니다: 2026-09-25"]);
  });
  it("V03 가격이 정수가 아니면 멈춘다", () => {
    expect(errorsOf(vaultWith("vault/price-list.md", (r) => r.replace('"price": 30000, "unit": null, "note": "방문 시 상담비로 전환"', '"price": "3만", "unit": null, "note": "방문 시 상담비로 전환"')))).toEqual(["V03 [7] 모양이 틀렸습니다"]);
  });
  it("오류는 모아서 한 번에 돌려준다", () => {
    const r = parseRules({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(20);
  });
});
