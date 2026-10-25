import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

function copy404Plugin(): Plugin {
  return {
    name: "copy-root-404",
    closeBundle() {
      const src404 = path.resolve(__dirname, "404.html");
      const destDir = path.resolve(__dirname, "dist");
      const dest404 = path.resolve(destDir, "404.html");
      if (existsSync(src404)) {
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        copyFileSync(src404, dest404);
      }
    },
  };
}

export default defineConfig({
  base: "/app/",
  build: {
    outDir: "dist/app",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [tailwindcss(), react(), copy404Plugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
      "^/(?!app|@|node_modules|src|public|favicon|.*\\..*)[^/]+/?$": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
});
