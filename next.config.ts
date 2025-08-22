import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb", // 업로드 상한 (필요시 조정)
    },
  },
};

export default nextConfig;
