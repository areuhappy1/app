import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "split-receipt · 카톡 복붙 1/N 정산",
  description:
    "카톡이나 메모장에 휘갈겨 쓴 정산 메모를 붙여넣으면 최소 송금 경로와 종이 영수증 카드로 정리해주는 1/N 정산 웹앱.",
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
