import { cp, mkdir, rm } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ["index.html", "styles", "scripts"]) {
  await cp(new URL(`../${name}`, import.meta.url), new URL(name === "index.html" ? "index.html" : `${name}/`, output), { recursive: true });
}
// In a static build, public assets are emitted at the URL root, as with Next.js.
await cp(new URL("../public/job-grid-logo.webp", import.meta.url), new URL("job-grid-logo.webp", output));
console.log("Static site built in dist/. This build does not deploy or connect to any backend.");
