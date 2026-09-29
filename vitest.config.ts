import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 코어(src/core)는 DOM도 시계도 쓰지 않는 순수 함수다(PRD F3 — 기준 시각은 인자).
 * 그래서 테스트 환경은 node 하나로 충분하다(다시봄 1935e5b와 같은 설정).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
