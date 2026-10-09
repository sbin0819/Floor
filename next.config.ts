import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  ...(process.env.FLOOR_STRESS_TEST === "1"
    ? {
        distDir: ".next-stress",
        allowedDevOrigins: ["127.0.0.1"],
        typescript: { tsconfigPath: "tsconfig.stress.json" },
      }
    : {}),
};

export default nextConfig;
