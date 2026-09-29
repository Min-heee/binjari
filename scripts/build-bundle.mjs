/**
 * 화면이 읽는 번들(src/generated/bundle.json)을 만든다. 정적 내보내기라 브라우저는 파일 시스템을 못 읽으므로,
 * 볼트 원문과 합성 기존 예약을 한 파일로 묶어 빌드에 넣는다(다시봄 1935e5b scripts/build-bundle.mjs 와 같은 방식).
 *
 * 여기서는 **읽어서 묶기만** 한다. 검증과 계산은 src/core가 한다(볼트 json이 깨졌으면 화면이 멈추고 이유를 보인다).
 * 번들은 원본에서 늘 다시 만든다(predev·prebuild·pretest·pretypecheck) — 커밋하지 않는다.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const vaultFiles = readdirSync(join(ROOT, "vault"))
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => ({ path: `vault/${f}`, raw: read(`vault/${f}`) }));

const bookings = JSON.parse(read("data/bookings.json"));

const bundle = {
  // 시연 기준 시각. src/demo/clock.ts의 DEMO_NOW와 같아야 한다(시험으로 확인).
  asOf: "2026-09-21T10:00:00+09:00",
  vaultFiles,
  bookings,
};

mkdirSync(join(ROOT, "src/generated"), { recursive: true });
writeFileSync(join(ROOT, "src/generated/bundle.json"), JSON.stringify(bundle));
console.log(`번들: 볼트 ${vaultFiles.length}편, 기존 예약 ${bookings.bookings.length}건 → src/generated/bundle.json`);
