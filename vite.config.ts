import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { copyFileSync } from "node:fs";
export default defineConfig({
  plugins: [svelte(), {
    name: "plugin-manifest",
    closeBundle() { copyFileSync("manifest.json", "dist/manifest.json"); },
  }],
  resolve: { dedupe: ["svelte"] },
  build: {
    target: "es2022", minify: false, cssCodeSplit: false,
    lib: { entry: "src/main.ts", formats: ["cjs"], fileName: () => "main.js", cssFileName: "styles" },
    rollupOptions: { external: ["obsidian", "electron"] },
  },
});
