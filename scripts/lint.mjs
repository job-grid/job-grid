import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/global.css", import.meta.url), "utf8");
const tokens = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8");
const employerHtml = await readFile(new URL("../employer-jobs.html", import.meta.url), "utf8");
const employerCss = await readFile(new URL("../styles/employer.css", import.meta.url), "utf8");
const employerScript = await readFile(new URL("../scripts/employer-jobs.js", import.meta.url), "utf8");
const runtimeConfig = await readFile(new URL("../scripts/runtime-config.js", import.meta.url), "utf8");
const buildScript = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
const checks = [
  [html.includes('<html lang="en">'), "HTML language is declared"],
  [html.includes('href="#main"'), "Skip navigation link exists"],
  [html.includes('id="main"'), "Main landmark exists"],
  [html.includes('name="description"'), "Page description metadata exists"],
  [css.includes(":focus-visible"), "Visible keyboard focus styling exists"],
  [css.includes("@media (max-width: 740px)"), "Mobile breakpoint exists"],
  [css.includes("@media (prefers-reduced-motion: reduce)"), "Reduced motion preference is respected"],
  [tokens.includes("--color-primary:") && tokens.includes("--color-text:") && tokens.includes("--color-border:"), "Core design tokens exist"],
  [!html.includes('href="#"'), "No empty placeholder links exist"],
  [!html.includes("supabase.from(") && !html.includes("DATABASE_URL"), "Homepage does not query a database"],
  [employerHtml.includes('name="robots" content="noindex, nofollow"'), "Employer workspace is not indexable"],
  [employerHtml.includes('id="close-vacancy-dialog"') && employerHtml.includes('id="confirm-close"'), "Close Job action requires explicit confirmation"],
  [employerHtml.includes('id="portal-notice"') && employerHtml.includes('id="connection-message"'), "Employer setup gates have an accessible status message"],
  [employerCss.includes("@media (max-width: 740px)") && employerCss.includes(":focus-visible"), "Employer page has mobile layout and keyboard focus"],
  [runtimeConfig.includes('supabaseUrl: ""') && runtimeConfig.includes('publishableKey: ""'), "Runtime backend configuration is disabled by default"],
  [employerScript.includes("window?.jobGridAuth") && employerScript.includes("auth.getSession"), "Employer actions require the approved auth session adapter"],
  [employerScript.includes("getFreshEmployerSession(auth, session)") && employerScript.includes("session = await getFreshEmployerSession(auth, session)"), "Employer API calls refresh the active session before using its bearer token"],
  [employerScript.includes('elements.dialog.addEventListener("cancel"') && employerScript.includes("if (busy) {\n      event.preventDefault();"), "Close confirmation cannot be dismissed with Escape while a request is running"],
  [employerScript.includes("Idempotency-Key") && employerScript.includes("expected_version"), "Close Job uses an idempotency key and expected version"],
  [buildScript.includes('"employer-jobs.html"') && buildScript.includes('"employer-jobs.js"'), "Employer page and client are packaged into the static build"],
];
let failed = false;
for (const [passed, description] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${description}`);
  if (!passed) failed = true;
}
const syntax = spawnSync(process.execPath, ["scripts/check-syntax.mjs"], { stdio: "inherit" });
if (syntax.status !== 0) failed = true;
if (failed) process.exit(1);
console.log("Lint checks passed.");
