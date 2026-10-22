import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Chrome } from "./_components/Chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "빈자리",
  description: "가상 의원 · 합성 예약. 전화 예약의 빈 시간은 규칙으로 계산하고, 확정은 사람이 합니다.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Chrome />
        <main>{children}</main>
      </body>
    </html>
  );
}
