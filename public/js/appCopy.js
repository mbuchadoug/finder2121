// public/js/app.js
// Main frontend JS for search, rendering results and showing St-Eurit downloads

const $ = (id) => document.getElementById(id);

const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getMulti = (id) =>
  Array.from(($(id)?.selectedOptions ?? [])).map((o) => o.value).filter(Boolean);

function toArrayChecked(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((el) => el.value);
}

/**
 * submitPrefs
 * Called when the find form is submitted. Sends POST /api/recommend and renders results.
 */
async function submitPrefs(ev) {
  ev && ev.preventDefault && ev.preventDefault();

  const btn = $("findBtn");
  const out = $("results");
  const loader = $("loader");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Finding schools…";
  }
  if (loader) loader.style.display = "inline-block";
  if (out) out.innerHTML = "";

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
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `HTTP ${res.status}`);
    }

    const data = await res.json();
    renderResults(data?.recommendations || [], data?.pinnedSchool || null);
  } catch (e) {
    out.innerHTML = `<div class="card">Error: ${escapeHtml(e.message || "Failed to fetch")}</div>`;
    console.error("recommend error:", e);
  } finally {
    if (loader) loader.style.display = "none";
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Find Schools";
    }
  }
}

/**
 * renderResults
 * Renders the list of recommendation objects into #results.
 * If pinnedSchool is present, shows pinned details first.
 */
function renderResults(list = [], pinnedSchool = null) {
  const out = $("results");
  out.innerHTML = "";

  // Show pinned school prominently (if provided)
  if (pinnedSchool) {
    const pinDiv = document.createElement("div");
    pinDiv.className = "card";
    const pinName = escapeHtml(pinnedSchool.name || "Featured School");
    const hero = pinnedSchool.heroImage || "/img/school-placeholder.png";
    pinDiv.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center">
        <img src="${escapeHtml(hero)}" alt="${pinName}" style="width:120px;height:80px;object-fit:cover;border-radius:8px">
        <div style="flex:1">
          <strong style="font-size:1.05rem">${pinName}</strong>
          <div style="margin-top:6px">
            ${pinnedSchool.registerUrl ? `<a class="btn btn-sm" href="${escapeHtml(pinnedSchool.registerUrl)}">Register online</a>` : ""}
            ${pinnedSchool.downloads ? `
              <a class="btn btn-light btn-sm" href="${escapeHtml(pinnedSchool.downloads.registration)}" download>Registration (PDF)</a>
              <a class="btn btn-light btn-sm" href="${escapeHtml(pinnedSchool.downloads.profile)}" download>School Profile (PDF)</a>
              <a class="btn btn-light btn-sm" href="${escapeHtml(pinnedSchool.downloads.enrollment)}" download>Enrollment (PDF)</a>
            ` : ""}
          </div>
        </div>
      </div>
    `;
    out.appendChild(pinDiv);
  }

  if (!Array.isArray(list) || list.length === 0) {
    out.innerHTML += '<div class="card">No matches yet. Try widening your filters.</div>';
    return;
  }

  list.forEach((r) => {
    const name = escapeHtml(r.name || "");
    const city = escapeHtml(r.city || "");
    const curriculum = Array.isArray(r.curriculum) ? escapeHtml(r.curriculum.join(", ")) : escapeHtml(r.curriculum || "");
    const type = Array.isArray(r.type) ? escapeHtml(r.type.join(", ")) : escapeHtml(r.type || "");
    const type2 = Array.isArray(r.type2) ? escapeHtml(r.type2.join(", ")) : escapeHtml(r.type2 || "");
    const reason = escapeHtml(r.reason || "");
    const env = r.learningEnvironment ? ` · ${escapeHtml(r.learningEnvironment)}` : "";
    const imgUrl = r.heroImage || r.logo || "/img/school-placeholder.png";

    const slug = (r.slug || "").toLowerCase();
    const isStEuritBySlug = slug === "st-eurit-international-school" || slug === "st-eurit-international-school-harare" || slug === "st-eurit-international-school-harare";
    const isStEuritByName = (r.name || "").toLowerCase().includes("st eurit");
    const isStEurit = isStEuritBySlug || isStEuritByName;

    const div = document.createElement("div");
    div.className = "result";

    const regHref = (r.registerUrl) || (r.slug ? `/register/${encodeURIComponent(r.slug)}` : '/register/st-eurit-international-school');

    // Enrollment PDF path for inline link fallback (server exposes /download keys)
    const enrollmentPdfPath = "/download/st-eurit-enrollment";
    const profilePdfPath = "/download/st-eurit-profile";
    const registrationPdfPath = "/download/st-eurit-registration";

    div.innerHTML = `
      <img src="${escapeHtml(imgUrl)}" onerror="this.src='/img/school-placeholder.png'" alt="${name}" style="width:64px;height:64px;border-radius:8px;object-fit:cover">
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${name}</strong>
          ${isStEurit ? `<a href="mailto:enquiries@steuritintenationalschool.org" class="tag-recommended" target="_blank">Recommended</a>` : ""}
        </div>
        <div>${city}${env}${curriculum ? " · " + curriculum : ""}${type ? " · " + type : ""}${type2 ? " · " + type2 : ""}</div>
        <div class="subtext">Reason: ${reason || "—"}</div>
        ${isStEurit ? `
          <div class="download-row" style="margin-top:8px">
            <a class="btn btn-sm" href="${escapeHtml(registrationPdfPath)}" download>Download Registration Form</a>
            <a class="btn btn-light btn-sm" href="${escapeHtml(profilePdfPath)}" download>Download School Profile</a>
            <a class="btn btn-light btn-sm" href="${escapeHtml(enrollmentPdfPath)}" download>Enrollment Requirements</a>
            ${regHref ? `<a class="btn btn-sm btn-success" href="${escapeHtml(regHref)}">Fill Registration Form Online</a>` : ''}
          </div>` : ``}
      </div>
    `;
    out.appendChild(div);
  });
}

/* page init */
window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("prefsForm");
  if (form) form.addEventListener("submit", submitPrefs);

  // attach click handler to any initial Find button if present
  const findBtn = $("findBtn");
  if (findBtn) {
    findBtn.addEventListener("click", (e) => {
      // If the button is outside a form, call submitPrefs
      if (!form) submitPrefs(e);
    });
  }

  // if you want auto-run on load, uncomment:
  // submitPrefs();
});
