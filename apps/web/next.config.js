import { loadRepoEnv } from "../../packages/backend-common/load-env.mjs";

loadRepoEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@excalidraw/excalidraw"],
  // 127.0.0.1 is a second origin, so a second localStorage identity for testing guests locally.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
