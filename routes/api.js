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

  if (city) and.push({ city: { $regex: rxContains(city) } });

  if (learningEnvironment) {
    and.push({ learningEnvironment: { $regex: rxContains(learningEnvironment) } });
  }

  const cur = toArray(curriculum);
  if (cur.length) {
    const regs = makeContainsRegexes(cur, CURR_SYNONYMS);
    and.push({ curriculum_list: { $in: regs } });
  }

  const phases = toArray(type);
  if (phases.length) {
    const regs = makeContainsRegexes(phases, PHASE_SYNONYMS);
    and.push({ type: { $in: regs } });
  }

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
          { "facilities.boarding": true },
        ],
      });
    } else if (wantDay) {
      const regs = makeContainsRegexes(TYPE2_DAY);
      and.push({
        $or: [
          { type2: { $in: regs } },
          { "facilities.boarding": { $ne: true } },
        ],
      });
    }
  }

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
  const selectedZimsec = toArray(curriculum).some((v) => /zimsec/i.test(v));
  const selectedHighSchool = toArray(type).some((v) =>
    /high\s*school|secondary|senior/i.test(v)
  );
  const selectedBoarding = toArray(type2).some((v) => /boarding/i.test(v));

  //const shouldPin = !selectedZimsec && !selectedHighSchool && !selectedBoarding;
  // Force pinning for all recommend requests
  const shouldPin = true;

  const PINNED = (process.env.PINNED_SCHOOLS || "St Eurit International School")
    .split(/[|,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const isPinnedDoc = (d) => {
    const name = String(d.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    const slug = String(d.slug || "").toLowerCase().trim();
    const norm = String(d.normalizedName || "").toLowerCase().trim();
    return PINNED.includes(name) || PINNED.includes(slug) || PINNED.includes(norm);
  };

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

  /* ---------- scoring + reasons ---------- */
  const recommendations = docs.map((d) => {
    const reasons = [];
    const phases = toArray(type);
    const boardingType = toArray(type2);
    const cur = toArray(curriculum);

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
      (boardingType.length ? (boardingType.length > 1 ? 2 : 1) : 0) +
      (cur.length ? 1 : 0) +
      (facilities?.length ? 1 : 0);

    const match = denom ? (matched / denom) * 100 : 100;

    return {
      id: d._id,
      slug: d.slug, // expose slug
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
      _pinned: isPinnedDoc(d),
      pinned: isPinnedDoc(d) && shouldPin,
     registerUrl: d.slug ? `/register/${encodeURIComponent(d.slug)}` : undefined,

    };
  });

  // Sort: pinned first, then highest match, then name
  recommendations.sort((a, b) => {
    const aPinned = a._pinned && (a.pinned === true);
    const bPinned = b._pinned && (b.pinned === true);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (b.match !== a.match) return b.match - a.match;
    return (a.name || "").localeCompare(b.name || "");
  });

  const clean = recommendations.map(({ _pinned, ...rest }) => rest);
  res.json({ recommendations: clean });
});

export default router;
