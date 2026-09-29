import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// 다시봄 1935e5b eslint.config.mjs 를 바탕으로 했다.
const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**"],
  },
  { files: ["src/**/*.tsx"], rules: { "react-hooks/exhaustive-deps": "error" } },
  // 빈 시간은 기준 시각(src/demo/clock.ts DEMO_NOW_MS) 하나로만 잰다(PRD F3·F9). 실제 시계를 읽으면
  // 여는 날마다 빈 시간이 달라지고, 같은 입력에 같은 결과라는 약속이 깨진다. 코어는 purity.test.ts가 글자로 한 번 더 본다.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "기준 시각 DEMO_NOW_MS(src/demo/clock.ts)를 인자로 넘기세요." },
        { object: "performance", property: "now", message: "시계를 읽지 않습니다. 기준 시각을 인자로 넘기세요." },
        { object: "Math", property: "random", message: "같은 입력에 같은 결과여야 합니다(PRD 2절)." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "인자 없는 new Date()는 실제 시계를 읽습니다." },
        { selector: "VariableDeclarator > Identifier.init[name='Date']", message: "Date 별칭은 시계 검사를 우회합니다." },
        { selector: "CallExpression[callee.name='Date']", message: "Date()는 실제 시계를 읽습니다." },
        { selector: "MemberExpression[property.name='Date'][object.name=/^(globalThis|window|self)$/]", message: "globalThis.Date 등은 시계 검사를 우회합니다." },
        { selector: "CallExpression > Identifier.arguments[name='Date']", message: "Date를 인자로 넘기면 시계 검사를 우회합니다." },
        {
          selector: "CallExpression[arguments.length=0][callee.property.name=/^(format|formatToParts)$/][callee.object.callee.object.name='Intl']",
          message: "인자 없는 Intl 날짜 형식 호출은 지금 시각을 씁니다.",
        },
      ],
    },
  },
];

export default eslintConfig;
