import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const directory = new URL("./", import.meta.url);
const entries = await readdir(directory);
const jsFiles = entries.filter((name) => name.endsWith(".js") || name.endsWith(".mjs")).map((name) => path.resolve(new URL(name, directory).pathname));
let failed = false;
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || `Syntax check failed: ${file}\n`);
  }
}
if (failed) process.exit(1);
console.log(`Syntax checks passed for ${jsFiles.length} JavaScript files.`);
