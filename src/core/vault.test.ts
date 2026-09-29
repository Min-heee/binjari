import { describe, expect, it } from "vitest";
import { loadVault, parseVaultFile, selectCurrent, type VaultDoc } from "./vault";
import { vaultFiles } from "./__fixtures__/load";

/** 다시봄에서 가져와 고친 vault.ts(PRD 6절): B 접두어, assumption·approvedBy, B01 초안 예외. */

const fm = (id: string, extra = "", status = "approved") =>
  `---\nid: ${id}\ntitle: t\ntype: policy\nversion: 1\nstatus: ${status}\neffective: 2026-09-01\nowner: 원무팀\nfictional: true\n${extra}---\n본문\n`;

function doc(id: string, extra = "", status = "approved"): VaultDoc {
  const r = parseVaultFile(`${id}.md`, fm(id, extra, status));
  if (!r.ok) throw new Error(r.errors.join());
  return r.doc;
}

describe("문서 ID와 프런트매터", () => {
  it("V01·D01·B01 꼴을 받고 다른 접두어는 거부한다", () => {
    for (const id of ["V01", "V04b", "D01", "B01", "B02"]) expect(parseVaultFile("a.md", fm(id)).ok, id).toBe(true);
    expect(parseVaultFile("a.md", fm("X01"))).toEqual({ ok: false, path: "a.md", errors: ["id 형식이 틀렸습니다: X01"] });
  });
  it("assumption은 true/false만, approvedBy는 비울 수 없다", () => {
    expect(doc("B01", "assumption: true\napprovedBy: none\n", "draft").meta).toMatchObject({ assumption: true, approvedBy: "none" });
    expect(doc("V02").meta.assumption).toBe(false);
    expect(parseVaultFile("a.md", fm("B01", "assumption: yes\n"))).toEqual({ ok: false, path: "a.md", errors: ["assumption은 true 또는 false여야 합니다: yes"] });
    expect(parseVaultFile("a.md", fm("B01", "approvedBy: \n"))).toMatchObject({ ok: false });
  });
  it("모르는 키는 거부한다(assumptions 오타)", () => {
    expect(parseVaultFile("a.md", fm("B01", "assumptions: true\n"))).toEqual({ ok: false, path: "a.md", errors: ["모르는 필드입니다: assumptions"] });
  });
});

describe("B01 초안 예외", () => {
  const b01 = doc("B01", "assumption: true\n", "draft");
  it("허락한 ID의 draft + assumption만 쓰는 문서로 남기고 assumed에 올린다", () => {
    const s = selectCurrent([b01], { allowAssumptionDraft: ["B01"] });
    expect(s.active.map((d) => d.meta.id)).toEqual(["B01"]);
    expect(s.assumed).toEqual(["B01"]);
  });
  it("허락 목록이 없으면 예전처럼 초안으로 뺀다", () => {
    const s = selectCurrent([b01]);
    expect(s.active).toEqual([]);
    expect(s.excluded.map((x) => x.reason)).toEqual(["draft"]);
  });
  it("assumption 없는 초안은 허락 목록에 있어도 뺀다", () => {
    const s = selectCurrent([doc("B01", "", "draft")], { allowAssumptionDraft: ["B01"] });
    expect(s.active).toEqual([]);
  });
  it("저장소 볼트: B01만 assumed이고, 문서 12편을 모두 쓴다", () => {
    const v = loadVault(vaultFiles(), { asOf: "2026-09-21", allowAssumptionDraft: ["B01"] });
    expect(v.errors).toEqual([]);
    expect(v.assumed).toEqual(["B01"]);
    expect(v.active.map((d) => d.meta.id).sort()).toEqual(["B01", "B02", "V01", "V02", "V03", "V04", "V05", "V06", "V07", "V08", "V09", "V15"]);
  });
});
