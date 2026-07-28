import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(projectRoot, "node_modules", "pdfjs-dist");
const targetRoot = join(projectRoot, "public", "pdfjs");
const assetDirectories = ["cmaps", "standard_fonts"];

await mkdir(targetRoot, { recursive: true });

for (const directory of assetDirectories) {
  await cp(join(sourceRoot, directory), join(targetRoot, directory), { recursive: true });
}

console.log(`Synced PDF.js resources: ${assetDirectories.join(", ")}`);
