import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const form = document.querySelector("#candidate-application-form");
if (form) {
  const country = document.querySelector("#country-code");
  const status = document.querySelector("#application-status");
  const submit = document.querySelector("#submit-application");
  const jobId = document.querySelector("#application-job-id");
  const params = new URLSearchParams(window.location.search);
  const selectedJob = params.get("job") || "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedJob)) jobId.value = selectedJob;

  fetch(SUPABASE_URL + "/rest/v1/country_options?select=code,name&order=name.asc", {
    headers: { Accept: "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
  }).then(async (response) => {
    if (!response.ok) throw new Error("Country list unavailable.");
    const rows = await response.json();
    country.replaceChildren(new Option("Choose your country", ""));
    for (const item of rows) country.add(new Option(item.name, item.code));
    if (rows.some((item) => item.code === "KE")) country.value = "KE";
  }).catch(() => {
    country.replaceChildren(new Option("Country list unavailable — refresh to retry", ""));
    status.textContent = "We could not load the country list. Please refresh and try again.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    if (!form.reportValidity()) return;
    const file = document.querySelector("#cv").files?.[0];
    if (!file || file.size > 5 * 1024 * 1024) {
      status.textContent = "Choose a CV file no larger than 5 MB.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Submitting securely…";
    try {
      const response = await fetch(SUPABASE_URL + "/functions/v1/submit-application", {
        method: "POST",
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
        body: new FormData(form),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Application service is not ready yet.");
      form.reset();
      jobId.value = "";
      status.textContent = result.message || "Application received.";
      status.setAttribute("data-state", "success");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "We could not submit your application. Please try again.";
      status.setAttribute("data-state", "error");
    } finally {
      submit.disabled = false;
      submit.textContent = "Submit to Job Grid";
    }
  });
}