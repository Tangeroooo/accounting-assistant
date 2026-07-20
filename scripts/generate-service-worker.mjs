import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const outputDirectory = process.argv[2];
const basePath = process.argv[3] || "/";

if (!outputDirectory) throw new Error("사용법: node scripts/generate-service-worker.mjs <output-directory> <base-path>");

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return nested.flat();
}

const absoluteFiles = (await filesBelow(outputDirectory))
  .filter((file) => !file.endsWith(`${sep}sw.js`))
  .sort();
const files = absoluteFiles.map((file) => relative(outputDirectory, file).split(sep).join("/"));
const normalizedBase = `${basePath.replace(/\/+$/, "")}/`;
const urls = files.map((file) => `${normalizedBase}${file}`);
const revisionHash = createHash("sha256");
for (let index = 0; index < absoluteFiles.length; index += 1) {
  revisionHash.update(files[index]);
  revisionHash.update(await readFile(absoluteFiles[index]));
}
const revision = revisionHash.digest("hex").slice(0, 12);

const source = `const CACHE_NAME = "barun-web-${revision}";
const APP_BASE = ${JSON.stringify(normalizedBase)};
const PRECACHE = ${JSON.stringify(urls, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("barun-web-") && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(async () => (await caches.match(event.request)) || caches.match(APP_BASE + "index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  })));
});
`;

await writeFile(join(outputDirectory, "sw.js"), source);
console.log(`Generated ${join(outputDirectory, "sw.js")} with ${urls.length} cached files.`);
