import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    target: "es2020",
    outDir: "dist",
    // three.js is large but lazy-loaded, so we accept the warning
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split three.js and skinview3d into a separate chunk (only loaded when needed)
          "skinviewer": ["three", "skinview3d"],
        }
      }
    }
  }
});
