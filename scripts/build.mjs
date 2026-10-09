import { cp, mkdir, rm } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const name of ["index.html", "styles"]) {
  await cp(new URL(`../${name}`, import.meta.url), new URL(name === "index.html" ? "index.html" : `${name}/`, output), { recursive: true });
}

// Only browser-facing modules belong in the public static output.
// Keep repository tooling, backup/recovery scripts, tests, and validation
// utilities out of the downloadable website artifact.
await mkdir(new URL("scripts/", output), { recursive: true });
for (const name of ["components.js", "main.js"]) {
  await cp(new URL(`../scripts/${name}`, import.meta.url), new URL(`scripts/${name}`, output));
}

// Serve the official owner-supplied PNG at the site root.
await cp(new URL("../public/job-grid-logo.png", import.meta.url), new URL("job-grid-logo.png", output));
console.log("Static site built in dist/. This build does not deploy or connect to any backend.");
