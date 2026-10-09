class JobGridHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header class="site-header">
        <div class="header-inner">
          <a class="brand" href="#top" aria-label="Job Grid home">
            <span class="brand-placeholder" aria-label="Owner logo pending">LOGO<br>PENDING</span>
            <span class="brand-copy"><span class="brand-name">Job Grid</span><span class="brand-caption">Make your next move</span></span>
          </a>
          <nav class="nav-links" id="primary-navigation" aria-label="Main navigation">
            <a href="#featured-roles">Explore roles</a>
            <a href="#how-it-works">How it works</a>
            <a href="#footer">For employers</a>
          </nav>
          <div class="header-actions">
            <a class="button button-primary button-small" href="#featured-roles">Explore jobs <span aria-hidden="true">↗</span></a>
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
            <a class="brand" href="#top" aria-label="Job Grid home">
              <span class="brand-placeholder" aria-label="Owner logo pending">LOGO<br>PENDING</span>
              <span class="brand-copy"><span class="brand-name">Job Grid</span><span class="brand-caption">Make your next move</span></span>
            </a>
            <p>A clearer path to opportunity. We’re building a focused place for people and employers to connect around work.</p>
          </div>
          <nav class="footer-links" aria-label="Footer navigation">
            <a href="#featured-roles">Explore roles</a><a href="#how-it-works">How it works</a><a href="#top">Back to top ↑</a>
          </nav>
        </div>
        <div class="footer-bottom">© ${year} Job Grid. Brand assets pending owner approval. Job previews are illustrative only.</div>
      </footer>`;
  }
}
customElements.define("job-grid-footer", JobGridFooter);
