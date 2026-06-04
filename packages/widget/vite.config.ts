import { defineConfig } from "vite";

// Builds the embeddable widget as a single self-contained file: one IIFE bundle with
// the CSS inlined (imported via `?inline` and injected into the shadow root) and
// supabase-js bundled in (lazy-initialized at runtime). The host needs no build step
// and no `type="module"` — just <script async src="widget.js">.
export default defineConfig({
  build: {
    target: "es2018",
    lib: {
      entry: "src/index.ts",
      name: "CommentBoxWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    cssCodeSplit: false,
    minify: "esbuild",
    emptyOutDir: true,
  },
});
