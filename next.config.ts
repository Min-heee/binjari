import type { NextConfig } from "next";

// 다시봄 1935e5b next.config.ts 와 같은 선택.
const nextConfig: NextConfig = {
  // 정적 내보내기: 서버 런타임 없이 out/ 만으로 돈다(PRD 6절 스택). 가예약도 브라우저에만 남으므로(F7) 서버가 없다.
  output: "export",
  // 다른 앱 아래 경로에 품을 때(한창구 /binjari). 비우면 지금처럼 / 에서 연다.
  ...(process.env.BINJARI_BASE_PATH ? { basePath: process.env.BINJARI_BASE_PATH, env: { NEXT_PUBLIC_BASE_PATH: process.env.BINJARI_BASE_PATH } } : {}),
  // out/eval/index.html 하나로 경로를 정한다(정적 호스트마다 /eval 풀이가 달라지지 않게).
  trailingSlash: true,
  // 정적 내보내기에는 이미지 최적화 서버가 없다.
  images: { unoptimized: true },
};

export default nextConfig;
