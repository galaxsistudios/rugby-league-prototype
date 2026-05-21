import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/phaser")) {
            return "phaser";
          }

          if (id.includes("node_modules")) {
            return "vendor";
          }

          return undefined;
        },
      },
    },
  },
});
