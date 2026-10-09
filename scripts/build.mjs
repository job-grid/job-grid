import { cp, mkdir, rm } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
const publicFiles = ["index.html", "styles", "scripts", "public"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of publicFiles) {
  await cp(new URL(`../${name}`, import.meta.url), new URL(name === "index.html" ? "index.html" : `${name}/`, output), { recursive: true });
}
console.log("Static site built in dist/. This build does not deploy or connect to any backend.");
