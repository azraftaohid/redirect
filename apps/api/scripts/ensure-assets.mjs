import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../../web/dist");
const appDir = resolve(distDir, "app");
const appIndexHtml = resolve(appDir, "index.html");
const notFoundHtml = resolve(distDir, "404.html");

if (!existsSync(appDir)) {
  mkdirSync(appDir, { recursive: true });
}

if (!existsSync(appIndexHtml)) {
  writeFileSync(
    appIndexHtml,
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Redirect — Link Manager</title>
  </head>
  <body>
    <div id="root">
      <h1>Redirect — Link Manager</h1>
      <p>Frontend placeholder. Application will be loaded here.</p>
    </div>
  </body>
</html>
`,
    "utf8"
  );
}

if (!existsSync(notFoundHtml)) {
  writeFileSync(
    notFoundHtml,
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>404 Not Found</title>
  </head>
  <body>
    <h1>404 Not Found</h1>
    <p>The requested link or page could not be found.</p>
  </body>
</html>
`,
    "utf8"
  );
}
