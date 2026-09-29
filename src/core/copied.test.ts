import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkAdExpressions } from "./adcheck";
import { engine, repoFile } from "./__fixtures__/load";

/**
 * 다른 저장소에서 가져온 것(PRD 6절 표)이 원본과 같은지.
 * - B02 공휴일: 다시봄 1935e5b D01의 holidays·holidaysCoverage·출처 문단과 **바이트 단위로** 같아야 한다.
 *   D01 원문은 src/core/__fixtures__/dasibom-D01-1935e5b.md에 박아 두고, 옆에 다시봄 저장소가 있으면 그 커밋과도 대조한다.
 * - adcheck.ts·mask.ts: 한창구 e7e183a와 첫 줄(출처 주석)만 다르다. 한창구 저장소가 옆에 있을 때만 대조한다.
 * - 볼트 V 문서: 한창구 e7e183a와 같다(같은 가상 의원 문서).
 */

const WS = fileURLToPath(new URL("../../../", import.meta.url));
const D01 = readFileSync(fileURLToPath(new URL("./__fixtures__/dasibom-D01-1935e5b.md", import.meta.url)), "utf8");

function gitShow(repo: string, rev: string, path: string): string | null {
  const dir = join(WS, repo);
  if (!existsSync(join(dir, ".git"))) return null;
  try {
    return execFileSync("git", ["-C", dir, "show", `${rev}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function slice(text: string, from: string, to: string): string {
  const i = text.indexOf(from);
  const j = text.indexOf(to, i + from.length);
  if (i === -1 || j === -1) throw new Error(`조각을 찾지 못함: ${from}`);
  return text.slice(i, j);
}

describe("B02 ↔ 다시봄 D01(1935e5b)", () => {
  const b02 = repoFile("vault/holidays.md");
  it("holidaysCoverage·holidays json 줄이 글자 그대로 같다", () => {
    const a = slice(D01, '  "holidaysCoverage"', '\n  ],') + "\n  ]";
    const b = slice(b02, '  "holidaysCoverage"', "\n  ]\n}") + "\n  ]";
    expect(b).toBe(a);
    expect(a.split("\n").length).toBe(34);
  });
  it("출처 문단이 글자 그대로 같다", () => {
    const a = slice(D01, "## 법정 공휴일 목록의 출처", "\n## ");
    const b = slice(b02, "## 법정 공휴일 목록의 출처", "\n## ");
    expect(b).toBe(a);
  });
  const live = gitShow("dasibom", "1935e5b", "vault/followup-policy.md");
  it.skipIf(live === null)("박아 둔 D01 사본이 다시봄 1935e5b와 같다", () => {
    expect(D01).toBe(live);
  });
});

describe("한창구 e7e183a에서 그대로 복사한 파일", () => {
  for (const f of ["adcheck.ts", "mask.ts"]) {
    const orig = gitShow("hanchanggu", "e7e183a", `src/core/${f}`);
    it.skipIf(orig === null)(`${f}는 첫 줄(출처 주석)만 다르다`, () => {
      const mine = repoFile(`src/core/${f}`);
      expect(mine.split("\n")[0]).toMatch(/^\/\/ 한창구 e7e183a src\/core\/.+ 에서 복사\(그대로\)/);
      expect(mine.split("\n").slice(1).join("\n")).toBe(orig);
    });
  }
  const origMaskTest = gitShow("hanchanggu", "e7e183a", "src/core/mask.test.ts");
  it.skipIf(origMaskTest === null)("mask.test.ts도 첫 줄만 다르다(원본 시험을 그대로 돌린다)", () => {
    expect(repoFile("src/core/mask.test.ts").split("\n").slice(1).join("\n")).toBe(origMaskTest);
  });
  for (const v of ["about", "hours-location", "price-list", "booking-policy", "consultation-guide", "surgery-prep", "postop-care", "injection-program", "scalp-care", "ad-expression-guide"]) {
    const orig = gitShow("hanchanggu", "e7e183a", `vault/${v}.md`);
    it.skipIf(orig === null)(`vault/${v}.md가 한창구와 같다`, () => expect(repoFile(`vault/${v}.md`)).toBe(orig));
  }
});

describe("adcheck — 이 볼트의 V15로 돈다", () => {
  it("금지 표현은 banned, 주의 표현은 warn(공백을 무시하고 찾는다)", () => {
    const { ad } = engine();
    expect(checkAdExpressions("효과 100 % 보장", ad).hits.map((h) => [h.level, h.matchedText])).toEqual([
      ["warn", "효과"],
      ["banned", "100 %"],
      ["warn", "보장"],
    ]);
    expect(checkAdExpressions("지금 비어 있는 시간을 말씀드릴게요.", ad).level).toBe("clean");
  });
});
