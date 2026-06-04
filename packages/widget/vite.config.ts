import { defineConfig } from "vite";

// Phase 1: this config serves the dev harness (packages/widget/index.html) and
// produces a first build. The single-file IIFE bundle with INLINED css and a
// lazy-loaded Supabase client is finalized in Phase 2.
export default defineConfig({
  build: {
    target: "es2018",
    lib: {
      entry: "src/index.ts",
      name: "CommentBoxWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    // Keep everything in one file; CSS inlining into the JS bundle lands in Phase 2.
    cssCodeSplit: false,
    minify: "esbuild",
    emptyOutDir: true,
  },
});
