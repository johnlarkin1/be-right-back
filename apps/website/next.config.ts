import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    root: __dirname,
  },
  // @excalidraw/excalidraw ships ESM and needs transpilation
  transpilePackages: ["@excalidraw/excalidraw"],
  // /about was folded into the preface article. The old Q&A is gone, so
  // /about#<question> deep links land at the top of the preface.
  async redirects() {
    return [{ source: "/about", destination: "/how-its-built/preface", permanent: true }];
  },
};

export default nextConfig;
