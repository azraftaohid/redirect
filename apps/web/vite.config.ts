import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const extraAllowedHosts = (
    process.env.ALLOWED_HOSTS ??
    process.env.VITE_ALLOWED_HOSTS ??
    env.ALLOWED_HOSTS ??
    env.VITE_ALLOWED_HOSTS ??
    ""
  )
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return {
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
      host: true,
      allowedHosts: [...new Set([".local", ".ts.net", ...extraAllowedHosts])],
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
  };
});
