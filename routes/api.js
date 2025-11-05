// routes/api.js
import { Router } from "express";
import School from "../models/school.js";

const router = Router();

/* ---------------- helpers ---------------- */
const esc = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// case-insensitive "contains" and tolerant to extra whitespace
const rxContains = (s) =>
  new RegExp(esc(String(s).trim()).replace(/\s+/g, "\\s+"), "i");

// normalize any value to array
const toArray = (v) =>
  Array.isArray(v)
    ? v
    : typeof v === "string" && v
    ? v.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

// synonyms (for messy data)
const CURR_SYNONYMS = {
  Cambridge: ["cambridge", "caie", "cie"],
  ZIMSEC: ["zimsec"],
  IB: ["ib", "international baccalaureate"],
};

const PHASE_SYNONYMS = {
  "Pre-School": ["pre-school", "preschool", "early years", "ece"],
  "Primary School": ["primary school", "primary", "junior"],
  "High School": ["high school", "secondary", "senior"],
};

const TYPE2_DAY = ["day", "day & boarding", "day and boarding"];
const TYPE2_BOARDING = ["boarding", "day & boarding", "day and boarding"];

const makeContainsRegexes = (values, dict = null) => {
  const regs = [];
  for (const raw of values) {
    const val = String(raw).trim();
    const syns = dict ? (dict[val] || [val]) : [val];
    const uniq = new Set([val, ...syns]);
    for (const s of uniq) regs.push(rxContains(s));
  }
  return regs;
};

/* ---------------- route ---------------- */
router.post("/recommend", async (req, res) => {
  const {
    city = "Harare",
    learningEnvironment,
    curriculum,
    type,
    type2,
    facilities,
  } = req.body || {};

  // Build as a list of AND conditions, then combine
  const and = [];

  // City (contains, i)
  if (city) and.push({ city: { $regex: rxContains(city) } });

  // Learning environment (contains, i)
  if (learningEnvironment) {
    and.push({ learningEnvironment: { $regex: rxContains(learningEnvironment) } });
  }

  // Curriculum: allow synonyms + contains
  const cur = toArray(curriculum);
  if (cur.length) {
    const regs = makeContainsRegexes(cur, CURR_SYNONYMS);
    and.push({ curriculum_list: { $in: regs } });
  }

  // School phase (contains + synonyms)
  const phases = toArray(type);
  if (phases.length) {
    const regs = makeContainsRegexes(phases, PHASE_SYNONYMS);
    and.push({ type: { $in: regs } });
  }

  // Boarding / Day:
  // - Some schools store it in `type2` (strings)
  // - Others only indicate boarding via facilities.boarding = true
  const boardingType = toArray(type2);
  if (boardingType.length) {
    const wantDay = boardingType.some((v) => /day/i.test(v));
    const wantBoarding = boardingType.some((v) => /boarding/i.test(v));

    if (wantDay && wantBoarding) {
      // both selected → no filter (means "any")
    } else if (wantBoarding) {
      const regs = makeContainsRegexes(TYPE2_BOARDING);
      and.push({
        $or: [
          { type2: { $in: regs } },
          { "facilities.boarding": true }, // fallback
        ],
      });
    } else if (wantDay) {
      const regs = makeContainsRegexes(TYPE2_DAY);
      and.push({
        $or: [
          { type2: { $in: regs } },
          { "facilities.boarding": { $ne: true } }, // likely day-only
        ],
      });
    }
  }

  // Facilities: require ALL selected flags
  if (Array.isArray(facilities) && facilities.length) {
    for (const f of facilities) and.push({ [`facilities.${f}`]: true });
  }

  const filter = and.length ? (and.length === 1 ? and[0] : { $and: and }) : {};

  if (process.env.DEBUG_RECO === "1") {
    console.log("recommend.filter =", JSON.stringify(filter, null, 2));
  }

  /* ---------- fetch matching docs ---------- */
  let docs = await School.find(filter)
    .sort({ tier: 1, name: 1 })
    .limit(100)
    .lean();

  /* ---------- CONDITIONAL PINNING ---------- */
  // Do NOT pin if user selected any of:
  //  - ZIMSEC (curriculum) OR High School/Secondary (phase) OR Boarding (type2)
  const selectedZimsec = toArray(curriculum).some((v) => /zimsec/i.test(v));
  const selectedHighSchool = toArray(type).some((v) =>
    /high\s*school|secondary|senior/i.test(v)
  );
  const selectedBoarding = toArray(type2).some((v) => /boarding/i.test(v));

  const shouldPin = !selectedZimsec && !selectedHighSchool && !selectedBoarding;

  // Configure pinned school names/slugs via .env (defaults to St Eurit)
  const PINNED = (process.env.PINNED_SCHOOLS || "st eurit international school")
    .split(/[|,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const isPinnedDoc = (d) => {
    const name = String(d.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    const slug = String(d.slug || "").toLowerCase().trim();
    const norm = String(d.normalizedName || "").toLowerCase().trim();
    return PINNED.includes(name) || PINNED.includes(slug) || PINNED.includes(norm);
  };

  // If we should pin, but the pinned school isn't in the results (e.g. filters excluded it),
  // fetch it directly (same city for relevance) and add it to the front.
  if (shouldPin && !docs.some(isPinnedDoc)) {
    const cityRegex = city ? { $regex: rxContains(city) } : undefined;
    const pinnedNameRegs = PINNED.map((p) => new RegExp(`^${esc(p)}$`, "i"));

    const pinnedDoc = await School.findOne({
      ...(city ? { city: cityRegex } : {}),
      $or: [
        { name: { $in: pinnedNameRegs } },
        { slug: { $in: PINNED } },
        { normalizedName: { $in: PINNED } },
      ],
    }).lean();

    if (pinnedDoc) docs.unshift(pinnedDoc);
  }
  /* ---------------------------------------- */

  /* ---------- scoring + reasons ---------- */
  const totalSignals =
    (learningEnvironment ? 1 : 0) +
    (phases.length ? 1 : 0) +
    (boardingType.length ? 1 : 0) +
    (cur.length ? 1 : 0) +
    (facilities?.length ? 1 : 0);

  const recommendations = docs.map((d) => {
    const reasons = [];

    if (learningEnvironment && rxContains(learningEnvironment).test(d.learningEnvironment || ""))
      reasons.push(`${d.learningEnvironment} learning environment`);

    if (phases.length && (d.type || []).some((x) => makeContainsRegexes(phases, PHASE_SYNONYMS).some((r) => r.test(x))))
      reasons.push((d.type || []).join(" & "));

    if (boardingType.length) {
      const wantDay = boardingType.some((v) => /day/i.test(v));
      const wantBoarding = boardingType.some((v) => /boarding/i.test(v));
      const dayHit =
        (d.type2 || []).some((x) => makeContainsRegexes(TYPE2_DAY).some((r) => r.test(x))) ||
        d.facilities?.boarding !== true;
      const boardingHit =
        (d.type2 || []).some((x) => makeContainsRegexes(TYPE2_BOARDING).some((r) => r.test(x))) ||
        d.facilities?.boarding === true;

      if (wantDay && dayHit) reasons.push("Day");
      if (wantBoarding && boardingHit) reasons.push("Boarding");
    }

    if (cur.length && (d.curriculum_list || []).some((x) => makeContainsRegexes(cur, CURR_SYNONYMS).some((r) => r.test(x))))
      reasons.push((d.curriculum_list || []).join(", "));

    if (Array.isArray(facilities) && facilities.length) {
      const have = facilities.filter((f) => d.facilities?.[f]);
      if (have.length) reasons.push(`Facilities: ${have.join(", ")}`);
    }

    let matched = 0;
    if (learningEnvironment && rxContains(learningEnvironment).test(d.learningEnvironment || "")) matched++;
    if (phases.length && (d.type || []).some((x) => makeContainsRegexes(phases, PHASE_SYNONYMS).some((r) => r.test(x)))) matched++;
    if (boardingType.length) {
      const wantDay = boardingType.some((v) => /day/i.test(v));
      const wantBoarding = boardingType.some((v) => /boarding/i.test(v));
      const dayHit =
        (d.type2 || []).some((x) => makeContainsRegexes(TYPE2_DAY).some((r) => r.test(x))) ||
        d.facilities?.boarding !== true;
      const boardingHit =
        (d.type2 || []).some((x) => makeContainsRegexes(TYPE2_BOARDING).some((r) => r.test(x))) ||
        d.facilities?.boarding === true;
      if (wantDay && dayHit) matched++;
      if (wantBoarding && boardingHit) matched++;
    }
    if (cur.length && (d.curriculum_list || []).some((x) => makeContainsRegexes(cur, CURR_SYNONYMS).some((r) => r.test(x)))) matched++;
    if (Array.isArray(facilities) && facilities.length && facilities.every((f) => d.facilities?.[f])) matched++;

    const denom =
      (learningEnvironment ? 1 : 0) +
      (phases.length ? 1 : 0) +
      // count Day and Boarding as separate possible matches if both selected
      (boardingType.length ? (boardingType.length > 1 ? 2 : 1) : 0) +
      (cur.length ? 1 : 0) +
      (facilities?.length ? 1 : 0);

    const match = denom ? (matched / denom) * 100 : 100;

    return {
      id: d._id,
      name: d.name,
      city: d.city,
      curriculum: d.curriculum_list || [],
      type: d.type || [],
      type2: d.type2 || [],
      learningEnvironment: d.learningEnvironment,
      website: d.website,
      facebook: d.facebookUrl,
      match,
      reason: reasons.join(" · "),
      logo: d.logo,
      heroImage: d.heroImage,
      _pinned: isPinnedDoc(d), // internal flag used for sorting
    };
  });

  // Sort: pinned first (when allowed), then highest match, then name
  recommendations.sort((a, b) => {
    // If pinning is disabled for this query, treat both as unpinned
    const aPinned = a._pinned && shouldPin;
    const bPinned = b._pinned && shouldPin;

    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (b.match !== a.match) return b.match - a.match;
    return (a.name || "").localeCompare(b.name || "");
  });

  // Hide internal flag
  const clean = recommendations.map(({ _pinned, ...rest }) => rest);
  res.json({ recommendations: clean });
});

export default router;
