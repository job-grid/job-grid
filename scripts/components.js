class JobGridBrand extends HTMLElement {
  connectedCallback() {
    const variant = this.getAttribute("variant") === "footer" ? "footer" : "header";
    this.innerHTML = `
      <a class="brand brand-${variant}" href="/#top" aria-label="Job Grid home">
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
            <a href="/vacancies.html">Find jobs</a>
            <a href="/countries.html">Browse countries</a>
            <a href="/job-types.html">Explore job types</a>
            <a href="/#how-it-works">How it works</a>
            <a href="/for-employers.html">For employers</a>
          </nav>
          <div class="header-actions">
            <a class="button button-primary button-small" href="/vacancies.html">Find jobs <span aria-hidden="true">↗</span></a>
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
    this.innerHTML = `
      <footer class="site-footer" id="footer">
        <div class="footer-inner">
          <div class="footer-brand">
            <job-grid-brand variant="footer"></job-grid-brand>
            <p>A clearer path to opportunity. Apply through Job Grid and let our recruitment team help match your profile to suitable opportunities.</p>
          </div>
          <nav class="footer-links" aria-label="Footer navigation">
            <a href="/vacancies.html">Find jobs</a><a href="/countries.html">Browse countries</a><a href="/job-types.html">Explore job types</a><a href="/for-employers.html">For employers</a><a href="/#how-it-works">How it works</a><a href="/#top">Back to top ↑</a>
          </nav>
        </div>
        <div class="footer-bottom">© ${year} Job Grid. Official logo supplied by the owner. The role catalogue lists job types, not confirmed vacancies.</div>
      </footer>`;
  }
}
customElements.define("job-grid-footer", JobGridFooter);
