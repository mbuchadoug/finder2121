// routes/twilio_webhook.js
import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------- Helpers ---------- */

function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

/* ---------- Filter Parser ---------- */

function parseFiltersFromWords(words) {
  const filters = {
    curriculum: [],
    type2: [],
    schoolPhase: [],
    learningEnvironment: "",
    gender: "",
    facilities: [],
  };

  const add = (arr, v) => {
    if (v && !arr.includes(v)) arr.push(v);
  };

  for (const raw of words) {
    const w = raw.toLowerCase();

    // curriculum
    if (w === "cambridge") add(filters.curriculum, "Cambridge");
    if (w === "zimsec") add(filters.curriculum, "Zimsec");
    if (w === "ib") add(filters.curriculum, "IB");

    // boarding / day
    if (w === "boarding") add(filters.type2, "Boarding");
    if (w === "day") add(filters.type2, "Day");

    // phase
    if (w === "primary") add(filters.schoolPhase, "Primary School");
    if (w === "high" || w === "secondary") add(filters.schoolPhase, "High School");
    if (w === "preschool" || w === "pre") add(filters.schoolPhase, "Pre-School");

    // learning environment
    if (w === "advanced") filters.learningEnvironment = "Advanced";
    if (w === "enhanced") filters.learningEnvironment = "Enhanced";
    if (w === "comprehensive") filters.learningEnvironment = "Comprehensive";

    // gender
    if (w === "boys") filters.gender = "Boys";
    if (w === "girls") filters.gender = "Girls";
    if (w === "mixed") filters.gender = "Mixed";

    // facilities
    if (w === "swimming") add(filters.facilities, "swimmingPool");
    if (w === "science") add(filters.facilities, "scienceLabs");
    if (w === "computer") add(filters.facilities, "computerLab");
    if (w === "library") add(filters.facilities, "library");
    if (w === "transport") add(filters.facilities, "transportBuses");
    if (w === "wifi") add(filters.facilities, "wifiCampus");
  }

  return filters;
}

/* ---------- MAIN WEBHOOK ---------- */

router.post("/webhook", async (req, res) => {
  try {
    const rawFrom = String(req.body.From || "");
    const bodyRaw = String(req.body.Body || "").trim();
    const profileName = String(req.body.ProfileName || "");

    if (!rawFrom) return sendTwimlText(res, "Missing sender info");

    const providerId = rawFrom.replace(/^whatsapp:/i, "");
    const phone = normalizePhone(providerId);

    /* ---------- Load or create user ---------- */

    let user = await User.findOne({ provider: "whatsapp", providerId });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        phone,
        name: profileName || undefined,
        role: "user",
      });
    }

    const text = bodyRaw;
    const lctext = text.toLowerCase();

    /* ---------- MAIN MENU ---------- */

    const menuText = [
      "👋 Hi! I’m *ZimEduFinder*",
      "",
      "What are you looking for?",
      "",
      "1️⃣ Find Schools",
      "2️⃣ Find Private Tutors",
      "",
      "Reply with a number 👇",
    ].join("\n");

    // show menu ONLY for greetings or empty
    if (!lctext || ["hi", "hello", "hey"].includes(lctext)) {
      return sendTwimlText(res, menuText);
    }

    /* ---------- SCHOOL QUICK OPTIONS ---------- */

    let command = lctext;

    if (lctext === "1") {
      return sendTwimlText(
        res,
        [
          "🏫 *Find Schools*",
          "",
          "Choose an option:",
          "",
          "1️⃣ Harare · Cambridge · Advanced",
          "2️⃣ Harare · Cambridge · Boarding · Primary",
          "3️⃣ Harare · Boarding · Any curriculum",
          "4️⃣ Harare · Swimming pool · Family schools",
          "",
          "Or type:",
          "find harare cambridge advanced",
        ].join("\n")
      );
    }

    if (lctext === "2") {
      return sendTwimlText(
        res,
        [
          "👩‍🏫 *Private Tutors*",
          "",
          "Coming next:",
          "• Home tutors",
          "• Online tutors",
          "• Exam prep",
          "",
          "Teachers can register soon 📋",
        ].join("\n")
      );
    }

    /* ---------- DEEP SCHOOL NUMERIC COMMANDS ---------- */

    if (lctext === "1️⃣" || lctext === "1a" || lctext === "1") {
      command = "find harare cambridge advanced";
    }
    if (lctext === "2") {
      command = "find harare cambridge boarding primary enhanced";
    }
    if (lctext === "3") {
      command = "find harare boarding";
    }
    if (lctext === "4") {
      command = "find harare swimming day primary";
    }

    /* ---------- FIND LOGIC ---------- */

    const words = command.split(/\s+/).filter(Boolean);

    if (words[0] === "find") {
      const city = words[1] || "harare";
      const filters = parseFiltersFromWords(words.slice(2));

      const site = (process.env.SITE_URL || "").replace(/\/$/, "");
      if (!site) {
        return sendTwimlText(res, "Service temporarily unavailable.");
      }

      const payload = {
        city: city.charAt(0).toUpperCase() + city.slice(1),
        ...filters,
      };

      const resp = await axios.post(`${site}/api/recommend`, payload);
      const recs = resp.data?.recommendations || [];

      if (!recs.length) {
        return sendTwimlText(
          res,
          `No schools found for ${city}. Try another option.`
        );
      }

      const twiml = new MessagingResponse();
      let attachStEurit = false;

      const lines = [`🎓 Top schools in ${city}:`];

      for (const r of recs.slice(0, 5)) {
        lines.push(`\n• ${r.name}`);
        if (r.learningEnvironment) lines.push(`  ${r.learningEnvironment}`);
        if (r.website) lines.push(`  🌐 ${r.website}`);

        if (/st[\s-]*eurit/i.test(r.name)) {
          attachStEurit = true;
          lines.push(
            "  📝 Apply: https://skoolfinder.net/register/st-eurit-international-school"
          );
        }
      }

      /* ---------- MEDIA (PINNED SCHOOL) ---------- */

      if (attachStEurit) {
        const base = site;

        const img1 = twiml.message(
          "⭐ *Pinned School*\nSt Eurit International School\n📘 Cambridge\n📍 Harare"
        );
        img1.media(`${base}/docs/st-eurit.jpg`);

        const pdf1 = twiml.message("📄 School Profile");
        pdf1.media(`${base}/docs/st-eurit-profile.pdf`);

        const pdf2 = twiml.message("📄 Registration Form");
        pdf2.media(`${base}/docs/st-eurit-registration.pdf`);
      }

      twiml.message(lines.join("\n"));
      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    /* ---------- FALLBACK ---------- */

    return sendTwimlText(res, menuText);
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendTwimlText(res, "Something went wrong. Please try again.");
  }
});

export default router;
