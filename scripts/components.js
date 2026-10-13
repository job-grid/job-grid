class JobGridBrand extends HTMLElement {
  connectedCallback() {
    const variant = this.getAttribute("variant") === "footer" ? "footer" : "header";
    const path = window.location.pathname;
    const isHomePage = path === "/" || path.endsWith("/index.html");
    const brandHref = isHomePage ? "#top" : "/index.html#top";
    this.innerHTML = `
      <a class="brand brand-${variant}" href="${brandHref}" aria-label="Job Grid home">
        <img class="brand-logo" src="/job-grid-logo.png" width="96" height="96" alt="Official Job Grid emblem" decoding="async" />
        <span class="brand-copy"><span class="brand-name">Job Grid</span><span class="brand-caption">Make your next move</span></span>
      </a>`;
  }
}
customElements.define("job-grid-brand", JobGridBrand);

class JobGridHeader extends HTMLElement {
  connectedCallback() {
    const path = window.location.pathname;
    const isHomePage = path === "/" || path.endsWith("/index.html");
    const isJobsPage = path.endsWith("/jobs.html");
    const featuredHref = isHomePage ? "/jobs.html" : isJobsPage ? "#search-results" : "/jobs.html";
    const howHref = isHomePage ? "#how-it-works" : "/index.html#how-it-works";
    const employerHref = isHomePage ? "#footer" : "/index.html#footer";
    this.innerHTML = `
      <header class="site-header">
        <div class="header-inner">
          <job-grid-brand variant="header"></job-grid-brand>
          <nav class="nav-links" id="primary-navigation" aria-label="Main navigation">
            <a href="${featuredHref}">Explore roles</a>
            <a href="${howHref}">How it works</a>
            <a href="${employerHref}">For employers</a>
          </nav>
          <div class="header-actions">
            <a class="button button-primary button-small" href="${featuredHref}">Explore jobs <span aria-hidden="true">↗</span></a>
            <button class="menu-toggle" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="primary-navigation"><span aria-hidden="true">☰</span></button>
          </div>
        </div>
      </header>`;
  }
}
customElements.define("job-grid-header", JobGridHeader);

class JobGridFooter extends HTMLElement {
  connectedCallback() {
    const year = new Date().getFullYear();
    const path = window.location.pathname;
    const isHomePage = path === "/" || path.endsWith("/index.html");
    const featuredHref = isHomePage ? "/jobs.html" : "/jobs.html";
    const howHref = isHomePage ? "#how-it-works" : "/index.html#how-it-works";
    const backHref = isHomePage ? "#top" : "/index.html#top";
    this.innerHTML = `
      <footer class="site-footer" id="footer">
        <div class="footer-inner">
          <div class="footer-brand">
            <job-grid-brand variant="footer"></job-grid-brand>
            <p>A clearer path to opportunity. We’re building a focused place for people and employers to connect around work.</p>
          </div>
          <nav class="footer-links" aria-label="Footer navigation">
            <a href="${featuredHref}">Explore roles</a><a href="${howHref}">How it works</a><a href="${backHref}">Back to top ↑</a>
          </nav>
        </div>
        <div class="footer-bottom">© ${year} Job Grid. Official logo supplied by the owner. Job previews are illustrative only.</div>
      </footer>`;
  }
}
customElements.define("job-grid-footer", JobGridFooter);
