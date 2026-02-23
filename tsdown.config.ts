import { defineConfig } from "tsdown"

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    outDir: "dist",
    target: "es2022",
    platform: "node",
    outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  },
  {
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    dts: false,
    outDir: "dist",
    target: "es2022",
    platform: "node",
    outputOptions: {
      entryFileNames: "cli.js",
    },
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
])
