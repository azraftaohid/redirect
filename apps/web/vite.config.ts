import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

function copy404Plugin(): Plugin {
  return {
    name: "copy-root-404",
    closeBundle() {
      const src404 = path.resolve(import.meta.dirname, "404.html");
      const destDir = path.resolve(import.meta.dirname, "dist");
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

function injectBuildIdPlugin(): Plugin {
  return {
    name: "inject-build-id",
    closeBundle() {
      const distAppDir = path.resolve(import.meta.dirname, "dist/app");
      const indexPath = path.resolve(distAppDir, "index.html");
      const swPath = path.resolve(distAppDir, "sw.js");

      if (existsSync(indexPath) && existsSync(swPath)) {
        const indexHtml = readFileSync(indexPath, "utf8");
        const buildId = createHash("sha256").update(indexHtml).digest("hex").slice(0, 10);
        let swContent = readFileSync(swPath, "utf8");
        swContent = swContent.replace(/__BUILD_ID__/g, buildId);
        writeFileSync(swPath, swContent, "utf8");
      }
    },
  };
}

function devRootRedirectPlugin(): Plugin {
  return {
    name: "dev-root-redirect",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/" || req.url === "") {
          res.writeHead(302, { Location: "/app/" });
          res.end();
          return;
        }
        next();
      });
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
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [tailwindcss(), react(), copy404Plugin(), injectBuildIdPlugin(), devRootRedirectPlugin()],
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
