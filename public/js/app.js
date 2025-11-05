const $ = (id) => document.getElementById(id);
const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getMulti = (id) =>
  Array.from(($(id)?.selectedOptions ?? [])).map(o => o.value).filter(Boolean);

async function submitPrefs(ev) {
  ev.preventDefault();
  const btn = $("findBtn"), out = $("results"), loader = $("loader");
  btn.disabled = true; btn.textContent = "Finding schools…"; loader.style.display = "inline-block"; out.innerHTML = "";

  const payload = {
    city: $("city")?.value || "Harare",
    learningEnvironment: $("learningEnvironment")?.value || "",
    curriculum: getMulti("curriculum"),
    type: getMulti("type"),
    type2: getMulti("type2"),
    facilities: Array.from(document.querySelectorAll('input[name="facilities"]:checked')).map(x => x.value),
  };

  try {
    const res = await fetch("/api/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
    const data = await res.json();
    renderResults(data?.recommendations || []);
  } catch (e) {
    out.innerHTML = `<div class="card">Error: ${escapeHtml(e.message)}</div>`;
  } finally {
    loader.style.display = "none"; btn.disabled = false; btn.textContent = "Find Schools";
  }
}

function renderResults(list) {
  const out = $("results"); out.innerHTML = "";
  if (!Array.isArray(list) || list.length === 0) {
    out.innerHTML = '<div class="card">No matches yet. Try widening your filters.</div>'; return;
  }
  list.forEach((r) => {
    const name = escapeHtml(r.name || "");
    const city = escapeHtml(r.city || "");
    const curriculum = Array.isArray(r.curriculum) ? escapeHtml(r.curriculum.join(", ")) : "";
    const type = Array.isArray(r.type) ? escapeHtml(r.type.join(", ")) : "";
    const type2 = Array.isArray(r.type2) ? escapeHtml(r.type2.join(", ")) : "";
    const reason = escapeHtml(r.reason || "");
    const match = Number(r.match || 0).toFixed(1);
    const env = r.learningEnvironment ? ` · ${escapeHtml(r.learningEnvironment)}` : "";
    const imgUrl = r.image || r.heroImage || r.logo || "/img/school-placeholder.png";

    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `
      <img src="${imgUrl}" onerror="this.src='/img/school-placeholder.png'" alt="${name}" style="width:64px;height:64px;border-radius:8px;object-fit:cover">
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${name}</strong><div><span class="badge">${match}% match</span></div>
        </div>
        <div>${city}${env}${curriculum ? " · " + curriculum : ""}${type ? " · " + type : ""}${type2 ? " · " + type2 : ""}</div>
        <div style="font-size:13px;color:#475569">Reason: ${reason || "—"}</div>
      </div>`;
    out.appendChild(div);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("prefsForm")?.addEventListener("submit", submitPrefs);
});
