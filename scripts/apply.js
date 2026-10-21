import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const form = document.querySelector("#candidate-application-form");
if (form) {
  const country = document.querySelector("#country-code");
  const status = document.querySelector("#application-status");
  const submit = document.querySelector("#submit-application");
  const jobId = document.querySelector("#application-job-id");
  const destinationList = document.querySelector("#preferred-destinations");
  const addDestination = document.querySelector("#add-destination");
  const destinationsJson = document.querySelector("#preferred-destinations-json");
  let countries = [];
  const params = new URLSearchParams(window.location.search);
  const selectedJob = params.get("job") || "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedJob)) jobId.value = selectedJob;

  const destinationRows = () => [...destinationList.querySelectorAll("[data-destination-row]")];
  function syncDestinations() {
    const values = destinationRows().map((row) => ({
      country_code: row.querySelector(".destination-country").value,
      city: row.querySelector(".destination-city").value.trim().slice(0, 120),
    })).filter((item) => item.country_code);
    destinationsJson.value = JSON.stringify(values);
    destinationRows().forEach((row) => {
      row.querySelector(".remove-destination").disabled = destinationRows().length <= 1;
    });
  }
  function addDestinationRow(defaultCountry = "") {
    const row = document.createElement("div");
    row.dataset.destinationRow = "true";
    row.className = "filter-field destination-row";
    const label = document.createElement("label");
    label.textContent = "Preferred work country";
    const select = document.createElement("select");
    select.className = "destination-country";
    select.required = true;
    select.setAttribute("aria-label", "Preferred work country");
    select.add(new Option("Choose destination country", ""));
    for (const item of countries) select.add(new Option(item.name, item.code));
    select.value = defaultCountry;
    const cityLabel = document.createElement("label");
    cityLabel.textContent = "Preferred city or town (optional)";
    const city = document.createElement("input");
    city.type = "text";
    city.className = "destination-city";
    city.maxLength = 120;
    city.placeholder = "Enter a city or town, or leave blank";
    city.autocomplete = "off";
    city.setAttribute("aria-label", "Preferred city or town for selected country");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-secondary remove-destination";
    remove.textContent = "Remove country";
    remove.addEventListener("click", () => { row.remove(); syncDestinations(); });
    select.addEventListener("change", syncDestinations);
    city.addEventListener("input", syncDestinations);
    row.append(label, select, cityLabel, city, remove);
    destinationList.append(row);
    syncDestinations();
  }

  addDestination.addEventListener("click", () => addDestinationRow());
  // Render the first destination row immediately so the form never shows an empty section while the country catalogue loads.
  addDestinationRow();
  fetch(SUPABASE_URL + "/rest/v1/country_options?select=code,name&order=name.asc", {
    headers: { Accept: "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
  }).then(async (response) => {
    if (!response.ok) throw new Error("Country list unavailable.");
    countries = await response.json();
    country.replaceChildren(new Option("Choose your country", ""));
    for (const item of countries) country.add(new Option(item.name, item.code));
    if (countries.some((item) => item.code === "KE")) country.value = "KE";
    for (const row of destinationRows()) {
      const select = row.querySelector(".destination-country");
      const selectedCode = select.value;
      select.replaceChildren(new Option("Choose destination country", ""));
      for (const item of countries) select.add(new Option(item.name, item.code));
      select.value = selectedCode;
    }
    syncDestinations();
  }).catch(() => {
    country.replaceChildren(new Option("Country list unavailable — refresh to retry", ""));
    status.textContent = "We could not load the country list. Please refresh and try again.";
    addDestination.disabled = true;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    syncDestinations();
    if (!form.reportValidity()) return;
    const destinations = JSON.parse(destinationsJson.value || "[]");
    if (destinationRows().some((row) => !row.querySelector(".destination-country").value)) {
      status.textContent = "Choose a country for each preferred destination, or remove the unused row.";
      return;
    }
    const seen = new Set();
    for (const item of destinations) {
      if (seen.has(item.country_code)) {
        status.textContent = "Each preferred country should appear only once. Add a city or town under that country instead.";
        return;
      }
      seen.add(item.country_code);
    }
    const file = document.querySelector("#cv").files?.[0];
    if (!file || file.size > 5 * 1024 * 1024) {
      status.textContent = "Choose a CV file no larger than 5 MB.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Submitting securely…";
    try {
      const payload = new FormData(form);
      payload.set("preferred_destinations", JSON.stringify(destinations));
      const response = await fetch(SUPABASE_URL + "/functions/v1/submit-application", {
        method: "POST",
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
        body: payload,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Application service is not ready yet.");
      form.reset();
      destinationList.replaceChildren();
      addDestinationRow();
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
