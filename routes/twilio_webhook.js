// routes/twilio_webhook.js
import express from "express";
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------------- BASIC HELPERS ---------------- */

function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.status(200).send(twiml.toString());
}

function sendTwimlWithMedia(res, text, mediaUrls = []) {
  const twiml = new MessagingResponse();
  const msg = twiml.message(text || "");
  (mediaUrls || []).forEach((m) => m && msg.media(m));
  res.set("Content-Type", "text/xml");
  return res.status(200).send(twiml.toString());
}

function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

function toArraySafe(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

/* ---------------- FILTER PARSING ---------------- */

// map of keywords -> canonical curriculum values used in DB
const CURRICULUM_MAP = {
  cambridge: "Cambridge",
  caie: "Cambridge",
  zimsec: "Zimsec",
  ib: "IB",
};

// phases
const PHASE_MAP = {
  preschool: "Pre-School",
  pre: "Pre-School",
  nursery: "Pre-School",
  primary: "Primary School",
  junior: "Primary School",
  highschool: "High School",
  secondary: "High School",
};

// boarding / day
const TYPE2_KEYWORDS = ["day", "boarding"];

// learning environment
const LE_MAP = {
  comprehensive: "Comprehensive",
  enhanced: "Enhanced",
  advanced: "Advanced",
};

// gender
const GENDER_MAP = {
  boys: "Boys",
  boy: "Boys",
  girls: "Girls",
  girl: "Girls",
  mixed: "Mixed",
  coed: "Mixed",
};

// facilities
const FACILITY_KEYWORDS = {
  science: "Science Labs",
  labs: "Science Labs",
  computer: "Computer Lab",
  ict: "Computer Lab",
  library: "Library",
  robotics: "STEAM / Robotics",
  steam: "STEAM / Robotics",
  cambridgecentre: "Cambridge Centre",
  cambridgecenter: "Cambridge Centre",
  swimming: "Swimming Pool",
  pool: "Swimming Pool",
  rugby: "Rugby",
  hockey: "Hockey",
  tennis: "Tennis",
  basketball: "Basketball",
  football: "Football",
  soccer: "Football",
  counselling: "Counselling",
  counsel: "Counselling",
  sen: "Learning Support (SEN)",
  clinic: "School Clinic / Nurse",
  nurse: "School Clinic / Nurse",
  aftercare: "Aftercare",
  afterschool: "Aftercare",
  transport: "School Transport",
  bus: "School Transport",
  boarding: "Boarding", // also used as facility in some cases
};

function parseFilters(words) {
  const filters = {
    curriculum: [],
    schoolPhase: undefined,
    type2: [],
    learningEnvironment: undefined,
    gender: undefined,
    facilities: [],
  };

  for (const raw of words) {
    const w = raw.toLowerCase();

    // curriculum
    if (CURRICULUM_MAP[w]) {
      if (!filters.curriculum.includes(CURRICULUM_MAP[w])) {
        filters.curriculum.push(CURRICULUM_MAP[w]);
      }
      continue;
    }

    // phase
    if (PHASE_MAP[w] && !filters.schoolPhase) {
      filters.schoolPhase = PHASE_MAP[w];
      continue;
    }

    // type2 (day / boarding)
    if (TYPE2_KEYWORDS.includes(w)) {
      if (!filters.type2.includes(w === "day" ? "Day" : "Boarding")) {
        filters.type2.push(w === "day" ? "Day" : "Boarding");
      }
      continue;
    }

    // learning environment
    if (LE_MAP[w] && !filters.learningEnvironment) {
      filters.learningEnvironment = LE_MAP[w];
      continue;
    }

    // gender
    if (GENDER_MAP[w] && !filters.gender) {
      filters.gender = GENDER_MAP[w];
      continue;
    }

    // facilities
    if (FACILITY_KEYWORDS[w]) {
      if (!filters.facilities.includes(FACILITY_KEYWORDS[w])) {
        filters.facilities.push(FACILITY_KEYWORDS[w]);
      }
      continue;
    }
  }

  return filters;
}

/* ---------------- PINNED ST EURIT RESPONSE ---------------- */

function sendPinnedStEurit(res, school) {
  // 1st message: summary + two pictures
  const twiml = new MessagingResponse();

  const msg1Lines = [
    `⭐ Pinned school: ${school.name}`,
    school.city ? `📍 City: ${school.city}` : "",
    school.curriculum && school.curriculum.length
      ? `📘 Curriculum: ${Array.isArray(school.curriculum) ? school.curriculum.join(", ") : school.curriculum}`
      : "",
    "",
    "To apply:",
    `👉 Register: https://skoolfinder.net${school.registerUrl || "/register/st-eurit-international-school"}`,
  ].filter(Boolean);

  const msg1 = twiml.message(msg1Lines.join("\n"));
  msg1.media("https://skoolfinder.net/docs/st-eurit.jpg");
  msg1.media("https://skoolfinder.net/docs/st-eurit-pic2.jpg");

  // 2nd message: PDF download links (text only)
  const msg2Lines = [
    "📄 St Eurit documents:",
    "• Profile: https://skoolfinder.net/docs/st-eurit-profile.pdf",
    "• Registration form: https://skoolfinder.net/docs/st-eurit-registration.pdf",
    "• Enrollment requirements: https://skoolfinder.net/docs/st-eurit-enrollment-requirements.pdf",
  ];

  twiml.message(msg2Lines.join("\n"));

  res.set("Content-Type", "text/xml");
  return res.status(200).send(twiml.toString());
}

/* ---------------- MAIN WEBHOOK ---------------- */

router.post("/webhook", async (req, res) => {
  try {
    const params = req.body || {};
    const bodyRaw = String(params.Body || params.body || "").trim();
    const rawFrom = String(params.From || params.from || "");
    const profileName = String(params.ProfileName || params.profileName || "");

    const providerId = normalizePhone(rawFrom);
    if (!providerId) return sendTwimlText(res, "Missing sender.");

    // Save user once (no duplicates)
    await User.findOneAndUpdate(
      { provider: "whatsapp", providerId },
      {
        $setOnInsert: {
          provider: "whatsapp",
          providerId,
          name: profileName || undefined,
          role: "user",
        },
      },
      { upsert: true, new: true }
    );

    const text = bodyRaw;
    const lctext = text.toLowerCase();
    const words = lctext.split(/\s+/).filter(Boolean);

    /* ---------- HI / HELP ---------- */

    if (!lctext || lctext === "hi" || lctext === "hello" || lctext === "help") {
      const helpMsg = `
Hi! I'm ZimEduFinder 🤖

📍 Format:
find [city] [filters]

🏙 Cities (examples):
harare, bulawayo, mutare, gweru, masvingo

📘 Curriculum:
cambridge, zimsec, ib

🏫 Phase:
preschool, primary, highschool

🛏 Type:
day, boarding

🧠 Learning environment:
comprehensive, enhanced, advanced

🚻 Gender:
boys, girls, mixed

🏊 Facilities:
science, computer, library, robotics, cambridgecentre,
swimming, rugby, hockey, tennis, basketball, football,
counselling, sen, clinic, aftercare, transport, boarding

✅ Examples you can type:
find harare cambridge
find harare primary girls
find harare boarding swimming
find harare cambridge advanced mixed
find harare cambridge boarding primary enhanced girls swimming

⭐ Other:
fav add <slug>
help
      `.trim();
      return sendTwimlText(res, helpMsg);
    }

    /* ---------- FIND COMMAND ---------- */

    if (words[0] === "find") {
      const city = words[1] || "harare";
      const filters = parseFilters(words.slice(2));

      const payload = {
        city,
        curriculum: filters.curriculum,
        learningEnvironment: filters.learningEnvironment,
        schoolPhase: filters.schoolPhase,
        type2: filters.type2,
        facilities: filters.facilities,
        gender: filters.gender,
      };

      let resp;
      try {
        const site = (process.env.SITE_URL || "https://skoolfinder.net").replace(/\/$/, "");
        resp = await axios.post(`${site}/api/recommend`, payload, { timeout: 10000 });
      } catch (e) {
        console.error("TWILIO recommend error:", e?.message || e);
        return sendTwimlText(res, "Search failed — please try again later.");
      }

      const recs = (resp.data && resp.data.recommendations) || [];
      if (!recs.length) {
        return sendTwimlText(res, `No matches found for "${city}" with those filters. Try fewer filters or type "help".`);
      }

      // Try to find pinned St Eurit first
      const pinned = recs.find(
        (r) =>
          r.pinned === true ||
          /st[\s-]*eurit/.test(String(r.name || "").toLowerCase()) ||
          (r.slug && /st-eurit/.test(String(r.slug)))
      );

      if (pinned) {
        // Special rich response for St Eurit (images + PDF links)
        return sendPinnedStEurit(res, pinned);
      }

      // Fallback: normal list
      const lines = [`Top ${Math.min(5, recs.length)} matches for ${city}:`];

      recs.slice(0, 5).forEach((s) => {
        lines.push(`\n• ${s.name}${s.city ? " — " + s.city : ""}`);
        if (s.curriculum) {
          const curText = Array.isArray(s.curriculum) ? s.curriculum.join(", ") : s.curriculum;
          lines.push(`  Curriculum: ${curText}`);
        }
        if (s.fees) lines.push(`  Fees: ${s.fees}`);
        if (s.website) lines.push(`  Website: ${s.website}`);
      });

      lines.push("\nReply 'help' to see all filters.");
      return sendTwimlText(res, lines.join("\n"));
    }

    /* ---------- FAVOURITES ---------- */

    if (lctext.startsWith("fav add ") || lctext.startsWith("favorite add ")) {
      const slug = bodyRaw.split(/\s+/).slice(2).join(" ").trim();
      if (!slug) {
        return sendTwimlText(res, "Please provide the school slug, e.g. 'fav add st-eurit-international-school'");
      }

      try {
        const site = (process.env.SITE_URL || "https://skoolfinder.net").replace(/\/$/, "");
        const schoolResp = await axios
          .get(`${site}/api/school-by-slug/${encodeURIComponent(slug)}`, { timeout: 5000 })
          .catch(() => null);

        const school = schoolResp && schoolResp.data && schoolResp.data.school;
        if (!school) {
          return sendTwimlText(res, `School not found for slug "${slug}"`);
        }

        await User.findOneAndUpdate(
          { provider: "whatsapp", providerId },
          { $addToSet: { favourites: school._id } },
          { upsert: true }
        );

        return sendTwimlText(res, `Added "${school.name}" to your favourites.`);
      } catch (e) {
        console.error("fav add error:", e?.message || e);
        return sendTwimlText(res, "Could not add favourite — try again later.");
      }
    }

    /* ---------- UNKNOWN ---------- */

    return sendTwimlText(res, "Sorry, I didn't understand. Send *help* for usage.");
  } catch (err) {
    console.error("TWILIO webhook crash:", err);
    return sendTwimlText(res, "Server error; please try again later.");
  }
});

export default router;
