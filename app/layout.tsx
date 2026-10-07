import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { pretendard } from "@/lib/fonts";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Floor",
  description: "함께 일하는 공간을 연결해요.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
