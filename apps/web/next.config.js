import { loadRepoEnv } from "../../packages/backend-common/load-env.mjs";

loadRepoEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@excalidraw/excalidraw"],
};

export default nextConfig;
