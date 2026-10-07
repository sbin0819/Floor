import localFont from "next/font/local";

export const pretendard = localFont({
  src: "../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
  preload: true,
  fallback: ["system-ui", "sans-serif"],
});
