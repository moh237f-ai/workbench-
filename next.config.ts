import type { NextConfig } from "next";

/**
 * BUILD_TARGET=desktop  → fully static export (bundled into the Electron app;
 *                         works with zero network at build and runtime).
 * default               → standalone server (web preview: `npm run build && npm start`).
 */
const isDesktop = process.env.BUILD_TARGET === "desktop";

const nextConfig: NextConfig = isDesktop
  ? {
      output: "export",
      typescript: { ignoreBuildErrors: false },
      reactStrictMode: false,
    }
  : {
      output: "standalone",
      typescript: { ignoreBuildErrors: false },
      reactStrictMode: false,
    };

export default nextConfig;
