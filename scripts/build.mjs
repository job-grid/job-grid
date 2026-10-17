import { cp, mkdir, rm } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const name of ["index.html", "job-types.html", "vacancies.html", "countries.html", "country.html", "for-employers.html", "apply.html", "staff.html"]) {
  await cp(new URL(`../${name}`, import.meta.url), new URL(name, output));
}
await cp(new URL("../styles", import.meta.url), new URL("styles/", output), { recursive: true });

// Only browser-facing modules belong in the public static output.
await mkdir(new URL("scripts/", output), { recursive: true });
for (const name of ["components.js", "main.js", "location-picker.js", "job-types.js", "vacancies.js", "countries.js", "country.js", "apply.js", "staff.js", "supabase-config.js"]) {
  await cp(new URL(`../scripts/${name}`, import.meta.url), new URL(`scripts/${name}`, output));
}

// Ship the bundled country list and its required license notice with the static app.
await cp(new URL("../public/data/", import.meta.url), new URL("data/", output), { recursive: true });

// Serve the official owner-supplied PNG at the site root.
await cp(new URL("../public/job-grid-logo.png", import.meta.url), new URL("job-grid-logo.png", output));
await import("./generate-occupation-pages.mjs");
console.log("Static site built in dist/. This build does not deploy or connect to any backend.");
