const DATA_URL = "/data/job-grid-title-crosswalk-review.json";
const PAGE_SIZE = 24;
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[character]);
}
function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}
function badgeFor(level) {
  const labels = {
    exact_title_candidate:"Exact-title candidate",
    strong_text_candidate:"Strong text candidate",
    possible_text_candidate:"Possible text candidate",
    manual_review_required:"Manual review required"
  };
  return labels[level] || "Review required";
}
function makeCard(row) {
  const alternates = row.alternatives.map((candidate,index) =>
    `<li><strong>${escapeHtml(candidate.code)}</strong> — ${escapeHtml(candidate.title)} <span>score ${candidate.score.toFixed(3)}</span></li>`
  ).join("");
  return `<article class="crosswalk-card">
    <div class="crosswalk-card-head">
      <span class="crosswalk-source-category">${escapeHtml(row.starterCategoryName)}</span>
      <span class="crosswalk-assessment">${escapeHtml(badgeFor(row.matchAssessment))}</span>
    </div>
    <h3>${escapeHtml(row.starterTitle)}</h3>
    <p class="crosswalk-label">Suggested ISCO-08 group</p>
    <div class="crosswalk-target">
      <strong>${escapeHtml(row.suggestedIsco08Code)}</strong>
      <span>${escapeHtml(row.suggestedIsco08Title)}</span>
    </div>
    <p class="crosswalk-parent">${escapeHtml(row.suggestedMinorGroupCode)} · ${escapeHtml(row.suggestedMinorGroupTitle)}</p>
    <p class="crosswalk-score">Text match score: ${row.textMatchScore.toFixed(3)} <span>· Not a probability</span></p>
    <details><summary>Compare alternative candidates</summary><ol>${alternates}</ol></details>
    <div class="crosswalk-status"><span>Human review pending</span><span>Not approved</span></div>
  </article>`;
}
async function loadData() {
  const response=await fetch(DATA_URL,{headers:{Accept:"application/json"}});
  if(!response.ok) throw new Error("The starter-title crosswalk could not be loaded.");
  const data=await response.json();
  if(!Array.isArray(data.rows)||data.rows.length!==496||data.mapping_approved!==false)
    throw new Error("The crosswalk data did not pass its safety/count check.");
  return data;
}
function init(data) {
  const search=document.querySelector("#crosswalk-search");
  const category=document.querySelector("#crosswalk-category");
  const assessment=document.querySelector("#crosswalk-assessment");
  const count=document.querySelector("#crosswalk-count");
  const results=document.querySelector("#crosswalk-results");
  const more=document.querySelector("#load-more-crosswalk");
  const clear=document.querySelector("#clear-crosswalk-filters");
  let visible=PAGE_SIZE;
  for(const cat of data.categories){
    const option=document.createElement("option");
    option.value=cat.slug;option.textContent=cat.name;category.append(option);
  }
  document.querySelector("#starter-title-total").textContent=String(data.rows.length);
  function filteredRows(){
    const term=normalize(search.value);
    return data.rows.filter(row=>{
      const full=[row.starterTitle,row.starterCategoryName,row.suggestedIsco08Code,row.suggestedIsco08Title,row.suggestedMinorGroupTitle,row.alternatives.map(x=>x.code+" "+x.title).join(" ")].join(" ");
      return (!term||normalize(full).includes(term))&&
        (!category.value||row.starterCategorySlug===category.value)&&
        (!assessment.value||row.matchAssessment===assessment.value);
    });
  }
  function render(reset=false){
    if(reset) visible=PAGE_SIZE;
    const filtered=filteredRows(),shown=filtered.slice(0,visible);
    results.innerHTML=shown.length?shown.map(makeCard).join(""):'<p class="empty-results">No candidate matches found. Try another search or filter.</p>';
    const counts=data.match_assessment_counts;
    count.textContent=`Showing ${shown.length} of ${filtered.length} starter titles · ${counts.exact_title_candidate} exact-title candidates · ${counts.strong_text_candidate} strong text candidates · ${counts.possible_text_candidate} possible matches · ${counts.manual_review_required} need manual review. No mapping is approved.`;
    more.hidden=shown.length>=filtered.length;
    results.setAttribute("aria-busy","false");
  }
  search.addEventListener("input",()=>render(true));
  category.addEventListener("change",()=>render(true));
  assessment.addEventListener("change",()=>render(true));
  clear.addEventListener("click",()=>{search.value="";category.value="";assessment.value="";render(true);search.focus();});
  more.addEventListener("click",()=>{visible+=PAGE_SIZE;render(false);});
  render(true);
}
const count=document.querySelector("#crosswalk-count");
loadData().then(init).catch(error=>{
  count.textContent=error.message;
  document.querySelector("#crosswalk-results").innerHTML='<p class="empty-results">The crosswalk preview could not load. Please try again.</p>';
  document.querySelector("#crosswalk-results").setAttribute("aria-busy","false");
  document.querySelector("#load-more-crosswalk").hidden=true;
});
