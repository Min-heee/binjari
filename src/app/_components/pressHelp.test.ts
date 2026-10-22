import { describe, expect, it } from "vitest";
import { mustDemo } from "@/demo/data";
import { pressHelp } from "./Call";

describe("안건 버튼 도움말", () => {
  it("샘플의원 규칙이면 지금 문장 그대로", () => {
    expect(pressHelp(mustDemo().engine.rules.intake)).toBe("상담·재시술 2번, 시술 3번");
  });
  it("다른 의원 규칙이면 그 버튼 이름으로", () => {
    expect(pressHelp([{ label: "상담" }, { label: "시술", subs: [] }, { label: "재수술" }])).toBe("상담·재수술 2번, 시술 3번");
    expect(pressHelp([{ label: "상담" }])).toBe("상담 2번");
  });
});
