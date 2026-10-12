class JobGridBrand extends HTMLElement {
  connectedCallback() {
    const variant = this.getAttribute("variant") === "footer" ? "footer" : "header";
    this.innerHTML = `
      <a class="brand brand-${variant}" href="#top" aria-label="Job Grid home">
        <img class="brand-logo" src="/job-grid-logo.png" width="96" height="96" alt="Official Job Grid emblem" decoding="async" />
        <span class="brand-copy"><span class="brand-name">Job Grid</span><span class="brand-caption">Make your next move</span></span>
      </a>`;
  }
}
customElements.define("job-grid-brand", JobGridBrand);

class JobGridHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header class="site-header">
        <div class="header-inner">
          <job-grid-brand variant="header"></job-grid-brand>
          <nav class="nav-links" id="primary-navigation" aria-label="Main navigation">
            <a href="#featured-roles" data-public-nav="true">Explore roles</a>
            <a href="#how-it-works" data-public-nav="true">How it works</a>
            <a href="/employer-jobs.html" data-employer-nav="true">For employers</a>
          </nav>
          <div class="header-actions">
            <a class="button button-primary button-small" href="#featured-roles" data-public-nav="true">Explore jobs <span aria-hidden="true">↗</span></a>
            <a class="button button-primary button-small" href="/" data-employer-nav="true">Public site <span aria-hidden="true">↗</span></a>
            <button class="menu-toggle" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="primary-navigation"><span aria-hidden="true">☰</span></button>
          </div>
        </div>
      </header>`;
    const isEmployerPage = window.location.pathname.endsWith("/employer-jobs.html");
    this.querySelectorAll("[data-public-nav='true']").forEach((link) => { link.hidden = isEmployerPage; });
    this.querySelectorAll("[data-employer-nav='true']").forEach((link) => { link.hidden = !isEmployerPage; });
    const employerLink = this.querySelector("a[data-employer-nav='true'][href='/employer-jobs.html']");
    if (isEmployerPage && employerLink) employerLink.setAttribute("aria-current", "page");
  }
}
customElements.define("job-grid-header", JobGridHeader);

class JobGridFooter extends HTMLElement {
  connectedCallback() {
    const year = new Date().getFullYear();
    this.innerHTML = `
      <footer class="site-footer" id="footer">
        <div class="footer-inner">
          <div class="footer-brand">
            <job-grid-brand variant="footer"></job-grid-brand>
            <p>A clearer path to opportunity. We’re building a focused place for people and employers to connect around work.</p>
          </div>
          <nav class="footer-links" aria-label="Footer navigation">
            <a href="#featured-roles" data-public-nav="true">Explore roles</a><a href="/employer-jobs.html">Employer workspace</a><a href="#how-it-works" data-public-nav="true">How it works</a><a href="#top" data-public-nav="true">Back to top ↑</a><a href="/" data-employer-nav="true">Public site</a>
          </nav>
        </div>
        <div class="footer-bottom">© ${year} Job Grid. Official logo supplied by the owner. Job previews are illustrative only.</div>
      </footer>`;
    const isEmployerPage = window.location.pathname.endsWith("/employer-jobs.html");
    this.querySelectorAll("[data-public-nav='true']").forEach((link) => { link.hidden = isEmployerPage; });
    this.querySelectorAll("[data-employer-nav='true']").forEach((link) => { link.hidden = !isEmployerPage; });
  }
}
customElements.define("job-grid-footer", JobGridFooter);
