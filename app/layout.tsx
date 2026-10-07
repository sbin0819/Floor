import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { pretendard } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Floor",
  description: "함께 일하는 공간을 연결해요.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>{children}</body>
    </html>
  );
}
