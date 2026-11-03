// Zips dist-extension/ into sena-extension.zip, for people to download and
// load unpacked (chrome://extensions → Developer mode → Load unpacked).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const root = "dist-extension";
const files: Record<string, Uint8Array> = {};
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[`sena-extension/${relative(root, p)}`] = readFileSync(p);
  }
};
walk(root);
writeFileSync("sena-extension.zip", zipSync(files, { level: 9 }));
console.log(`sena-extension.zip: ${Object.keys(files).length} files`);
