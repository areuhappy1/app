import type { Metadata, Viewport } from "next";
import "./globals.css";

const description = "앱 설치 없이 영수증을 확인하고 토스로 바로 보내세요. 모임 1/N 정산 영수증.";

export const metadata: Metadata = {
  title: "split-receipt · 모임 1/N 정산",
  description,
  openGraph: {
    title: "🧾 정산 영수증이 도착했어요",
    description,
    type: "website",
    locale: "ko_KR",
    siteName: "split-receipt",
  },
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
