import { Router } from "express";
import School from "../models/school.js";
const router = Router();

const esc = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rxContains = (s) => new RegExp(esc(String(s).trim()).replace(/\s+/g, "\\s+"), "i");
const toArray = (v) =>
  Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];

const CURR_SYNONYMS = { Cambridge: ["cambridge", "caie", "cie"], ZIMSEC: ["zimsec"], IB: ["ib", "international baccalaureate"] };
const PHASE_SYNONYMS = { "Pre-School": ["pre-school", "preschool", "early years", "ece"], "Primary School": ["primary", "primary school"], "High School": ["high school", "secondary", "senior"] };

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

router.post("/recommend", async (req, res) => {
  try {
    const { city = "Harare", learningEnvironment, curriculum, type, type2, facilities } = req.body || {};
    const and = [];
    if (city) and.push({ city: { $regex: rxContains(city) } });
    if (learningEnvironment) and.push({ learningEnvironment: { $regex: rxContains(learningEnvironment) } });

    const cur = toArray(curriculum);
    if (cur.length) and.push({ curriculum_list: { $in: makeContainsRegexes(cur, CURR_SYNONYMS) } });

    const phases = toArray(type);
    if (phases.length) and.push({ type: { $in: makeContainsRegexes(phases, PHASE_SYNONYMS) } });

    const boardingType = toArray(type2);
    if (boardingType.length) {
      const wantDay = boardingType.some((v) => /day/i.test(v));
      const wantBoarding = boardingType.some((v) => /boarding/i.test(v));
      if (!wantDay && wantBoarding) {
        and.push({ $or: [{ type2: { $in: makeContainsRegexes(["boarding"]) } }, { "facilities.boarding": true }] });
      } else if (wantDay && !wantBoarding) {
        and.push({ $or: [{ type2: { $in: makeContainsRegexes(["day"]) } }, { "facilities.boarding": { $ne: true } }] });
      }
    }

    if (Array.isArray(facilities) && facilities.length) {
      for (const f of facilities) and.push({ [`facilities.${f}`]: true });
    }

    const filter = and.length ? (and.length === 1 ? and[0] : { $and: and }) : {};
    let docs = await School.find(filter).sort({ tier: 1, name: 1 }).limit(100).lean();

    // PINNING: look for special pinned school(s)
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

    if (!docs.some(isPinnedDoc)) {
      const pinnedDoc = await School.findOne({
        ...(city ? { city: { $regex: rxContains(city) } } : {}),
        $or: [{ name: new RegExp(`^${esc(PINNED[0])}$`, "i") }, { slug: PINNED[0] }, { normalizedName: PINNED[0] }],
      }).lean();
      if (pinnedDoc) docs.unshift(pinnedDoc);
    }

    // pinnedSchool object with downloads (only for pinned school)
    let pinnedSchool = null;
    if (PINNED.length) {
      try {
        const pinnedQueryOr = [];
        for (const p of PINNED) {
          pinnedQueryOr.push({ slug: p });
          pinnedQueryOr.push({ normalizedName: p });
          pinnedQueryOr.push({ name: new RegExp(`^${esc(p)}$`, "i") });
        }
        const pinnedDoc = await School.findOne({ $or: pinnedQueryOr }).select("name slug").lean();
        if (pinnedDoc) {
          pinnedSchool = {
            id: pinnedDoc._id,
            name: pinnedDoc.name,
            slug: pinnedDoc.slug,
            registerUrl: pinnedDoc.slug ? `/register/${encodeURIComponent(pinnedDoc.slug)}` : undefined,
            // expose downloads only for pinned school (these resolvable endpoints are in server.js)
            downloads: {
              registration: "/download/st-eurit-registration",
              profile: "/download/st-eurit-profile",
              enrollment: "/download/st-eurit-enrollment",
            },
            // hero image (in public/docs)
            heroImage: "/docs/st-eurit.jpg",
          };
        }
      } catch (e) {
        console.warn("pinnedSchool lookup failed:", e && e.message ? e.message : e);
      }
    }

    const recommendations = docs.map((d) => {
      const reasons = [];
      if (learningEnvironment && rxContains(learningEnvironment).test(d.learningEnvironment || "")) reasons.push(`${d.learningEnvironment} learning environment`);
      if (toArray(type).length && (d.type || []).length) reasons.push((d.type || []).join(" & "));
      if (toArray(type2).length && (d.type2 || []).length) reasons.push((d.type2 || []).join(", "));
      if (toArray(curriculum).length && (d.curriculum_list || []).length) reasons.push((d.curriculum_list || []).join(", "));
      const pinnedFlag = isPinnedDoc(d);
      return {
        id: d._id,
        slug: d.slug,
        name: d.name,
        city: d.city,
        curriculum: d.curriculum_list || [],
        type: d.type || [],
        type2: d.type2 || [],
        learningEnvironment: d.learningEnvironment,
        website: d.website,
        facebook: d.facebookUrl,
        reason: reasons.join(" · "),
        logo: d.logo,
        heroImage: d.heroImage,
        _pinned: pinnedFlag,
        pinned: pinnedFlag,
        registerUrl: pinnedFlag && d.slug ? `/register/${encodeURIComponent(d.slug)}` : undefined,
        // only expose downloads for pinned (keep small)
        downloads: pinnedFlag ? {
          registration: "/download/st-eurit-registration",
          profile: "/download/st-eurit-profile",
          enrollment: "/download/st-eurit-enrollment",
        } : undefined,
      };
    });

    // sort pinned first
    recommendations.sort((a, b) => {
      if (a._pinned && !b._pinned) return -1;
      if (!a._pinned && b._pinned) return 1;
      return (b.match || 0) - (a.match || 0);
    });

    const clean = recommendations.map(({ _pinned, ...rest }) => rest);

    return res.json({ recommendations: clean, pinnedSchool });
  } catch (err) {
    console.error("recommend route error:", err);
    res.status(500).send("recommend failed");
  }
});

export default router;
