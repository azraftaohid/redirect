import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../../web/dist");

const requiredFiles = [
  resolve(distDir, "app/index.html"),
  resolve(distDir, "app/manifest.webmanifest"),
  resolve(distDir, "app/sw.js"),
  resolve(distDir, "app/icon-192.png"),
  resolve(distDir, "app/icon-512.png"),
  resolve(distDir, "app/apple-touch-icon.png"),
  resolve(distDir, "404.html"),
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    console.error(`[verify-dist] ERROR: Required distribution file missing: ${file}`);
    console.error("Please run 'pnpm --filter @redirect/web build' before deploying.");
    process.exit(1);
  }
}

// Ensure no root index.html or root assets exist (strict subpath isolation)
const rootIndex = resolve(distDir, "index.html");
if (existsSync(rootIndex)) {
  console.error(`[verify-dist] ERROR: Found root index.html at ${rootIndex}. Assets must be scoped under dist/app/.`);
  process.exit(1);
}

const rootAssets = resolve(distDir, "assets");
if (existsSync(rootAssets)) {
  console.error(`[verify-dist] ERROR: Found root assets directory at ${rootAssets}. Assets must be scoped under dist/app/assets/.`);
  process.exit(1);
}

// Verify strict CSP compliance: no inline script tags in app/index.html
const indexHtmlContent = readFileSync(resolve(distDir, "app/index.html"), "utf8");
// Regex looking for <script> tags that don't have src="..." (i.e. inline script body)
const inlineScriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const inlineMatches = [...indexHtmlContent.matchAll(inlineScriptRegex)].filter(
  (match) => match[1] && match[1].trim().length > 0
);

if (inlineMatches.length > 0) {
  console.error("[verify-dist] ERROR: Detected inline <script> in dist/app/index.html, violating CSP:");
  for (const m of inlineMatches) {
    console.error(`  ${m[0].slice(0, 100)}...`);
  }
  process.exit(1);
}

// Verify that __BUILD_ID__ was replaced in sw.js
const swContent = readFileSync(resolve(distDir, "app/sw.js"), "utf8");
if (swContent.includes("__BUILD_ID__")) {
  console.error("[verify-dist] ERROR: __BUILD_ID__ placeholder was not replaced in dist/app/sw.js.");
  process.exit(1);
}

console.log("[verify-dist] SUCCESS: Distribution assets verified successfully.");
