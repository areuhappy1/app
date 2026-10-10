import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "split-receipt · 모임 1/N 정산",
  description:
    "참여자를 한 번만 등록하고 지출을 찍으면 최소 송금 경로와 종이 영수증 카드로 정리해주는 1/N 정산 웹앱.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#efe9dc",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
