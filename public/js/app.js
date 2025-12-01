const $ = (id) => document.getElementById(id);
const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getMulti = (id) =>
  Array.from(($(id)?.selectedOptions ?? [])).map(o => o.value).filter(Boolean);

async function submitPrefs(ev) {
  ev.preventDefault();
  const btn = $("findBtn"), out = $("results"), loader = $("loader");
  btn.disabled = true; 
  btn.textContent = "Finding schools…"; 
  loader.style.display = "inline-block"; 
  out.innerHTML = "";

  const payload = {
    city: $("city")?.value || "Harare",
    learningEnvironment: $("learningEnvironment")?.value || "",
    curriculum: getMulti("curriculum"),
    type: getMulti("type"),
    type2: getMulti("type2"),
    facilities: Array.from(document.querySelectorAll('input[name="facilities"]:checked')).map(x => x.value),
  };

  try {
    const res = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
    const data = await res.json();
    renderResults(data?.recommendations || []);
  } catch (e) {
    out.innerHTML = `<div class="card">Error: ${escapeHtml(e.message)}</div>`;
  } finally {
    loader.style.display = "none"; 
    btn.disabled = false; 
    btn.textContent = "Find Schools";
  }
}

function renderResults(list) {
  const out = $("results"); 
  out.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    out.innerHTML = '<div class="card">No matches yet. Try widening your filters.</div>';
    return;
  }

  list.forEach((r, idx) => {
    const name = escapeHtml(r.name || "");
    const city = escapeHtml(r.city || "");
    const curriculum = Array.isArray(r.curriculum) ? escapeHtml(r.curriculum.join(", ")) : "";
    const type = Array.isArray(r.type) ? escapeHtml(r.type.join(", ")) : "";
    const type2 = Array.isArray(r.type2) ? escapeHtml(r.type2.join(", ")) : "";
    const reason = escapeHtml(r.reason || "");
    const env = r.learningEnvironment ? ` · ${escapeHtml(r.learningEnvironment)}` : "";
    const imgUrl = r.image || r.heroImage || r.logo || "/img/school-placeholder.png";

    // Strict St Eurit detection: by slug or by name
    const slug = (r.slug || "").toLowerCase();
    const isStEuritBySlug = slug === "st-eurit-international-school-harare";
    const isStEuritByName = (r.name || "").toLowerCase().includes("st eurit");
    const isStEurit = isStEuritBySlug || isStEuritByName;

    const div = document.createElement("div");
    div.className = "result";

    // prefill mailto link with subject and body (for St Eurit only — kept for reference)
    const mailSubject = encodeURIComponent("EduLocate Enquiry – School Application");
    const mailBody = encodeURIComponent(
      "Dear Admissions Team,I am interested in applying for my child to join St Eurit International School. " +
      "Please share more details about the admission process.Kind regards,[Your Name][Your Contact Info]"
    );
    const mailLink = `mailto:enquiries@steuritinternationalschool.org?subject=${mailSubject}&body=${mailBody}`;

    // compute register href (fallback to slug or known st-eurit route)
    const regHref = (r.registerUrl) || (r.slug ? `/register/${encodeURIComponent(r.slug)}` : '/register/st-eurit-international-school-harare');

    // enrollment requirements path
    const enrollmentPdf = '/docs/st-eurit-enrollment-requirements.pdf';

    div.innerHTML = `
      <img src="${imgUrl}" onerror="this.src='/img/school-placeholder.png'" alt="${name}" style="width:64px;height:64px;border-radius:8px;object-fit:cover">
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${name}</strong>
          ${isStEurit ? `
            <a href="${mailLink}" class="tag-recommended" target="_blank" title="Send an enquiry email">
              Recommended
            </a>` : ""}
        </div>
        <div>${city}${env}${curriculum ? " · " + curriculum : ""}${type ? " · " + type : ""}${type2 ? " · " + type2 : ""}</div>
        <div class="subtext">Reason: ${reason || "—"}</div>
        ${isStEurit ? `
          <div class="download-row">
            <a class="btn btn-sm" href="/download/st-eurit-registration" type="application/pdf" download>
              Download Registration Form (PDF)
            </a>
            <a class="btn btn-light btn-sm" href="/download/st-eurit-profile" type="application/pdf" download>
              Download School Profile (PDF)
            </a>
            <a class="btn btn-light btn-sm" href="${enrollmentPdf}" type="application/pdf" download>
              Enrollment Requirements (PDF)
            </a>
            ${regHref ? `<a class="btn btn-sm btn-success" href="${regHref}">Fill Registration Form Online</a>` : ''}
          </div>` : ``}
      </div>`;
    out.appendChild(div);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("prefsForm")?.addEventListener("submit", submitPrefs);
});
