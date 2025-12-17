// routes/twilio_webhook.js
import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

import User from "../models/user.js";
import Tutor from "../models/tutor.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* =====================================================
   HELPERS
===================================================== */

function twimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(v) {
  return String(v || "").replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

/* =====================================================
   SCHOOL FILTER PARSER (UNCHANGED – WORKING)
===================================================== */

function parseFiltersFromWords(words) {
  const f = {
    curriculum: [],
    type2: [],
    schoolPhase: [],
    learningEnvironment: "",
    gender: "",
    facilities: [],
  };

  const add = (arr, v) => !arr.includes(v) && arr.push(v);

  for (const w0 of words) {
    const w = w0.toLowerCase();

    if (w === "cambridge") add(f.curriculum, "Cambridge");
    if (w === "zimsec") add(f.curriculum, "Zimsec");
    if (w === "ib") add(f.curriculum, "IB");

    if (w === "boarding") add(f.type2, "Boarding");
    if (w === "day") add(f.type2, "Day");

    if (w === "primary") add(f.schoolPhase, "Primary School");
    if (w === "high") add(f.schoolPhase, "High School");
    if (w === "pre") add(f.schoolPhase, "Pre-School");

    if (w === "advanced") f.learningEnvironment = "Advanced";
    if (w === "enhanced") f.learningEnvironment = "Enhanced";
    if (w === "comprehensive") f.learningEnvironment = "Comprehensive";

    if (w === "boys") f.gender = "Boys";
    if (w === "girls") f.gender = "Girls";
    if (w === "mixed") f.gender = "Mixed";

    if (w === "swimming") add(f.facilities, "swimmingPool");
    if (w === "computer") add(f.facilities, "computerLab");
    if (w === "science") add(f.facilities, "scienceLabs");
    if (w === "library") add(f.facilities, "library");
    if (w === "aftercare") add(f.facilities, "aftercare");
  }

  return f;
}

/* =====================================================
   SUBJECT CATEGORIES (IMPORTANT)
===================================================== */

const SUBJECT_CATEGORIES = {
  "1": { name: "Mathematics", subjects: ["Mathematics"] },
  "2": { name: "Sciences", subjects: ["Physics", "Chemistry", "Biology"] },
  "3": {
    name: "Commercial Subjects",
    subjects: ["Accounting", "Economics", "Business Studies"],
  },
  "4": { name: "Languages", subjects: ["English"] },
  "5": { name: "ICT", subjects: ["Computer Science", "ICT"] },
};

/* =====================================================
   MAIN WEBHOOK
===================================================== */

router.post("/webhook", async (req, res) => {
  try {
    const Body = String(req.body.Body || "").trim();
    const lc = Body.toLowerCase();
    const From = req.body.From;

    if (!From) return twimlText(res, "Missing sender");

    const phone = normalizePhone(From);

    let user = await User.findOne({ provider: "whatsapp", providerId: phone });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId: phone,
        phone,
        chatState: "HOME",
      });
    }

    /* ========== GLOBAL RESET ========== */
    if (["hi", "menu", "home", "start"].includes(lc)) {
      user.chatState = "HOME";
      user.tutorDraft = {};
      await user.save();

      return twimlText(
        res,
        [
          "👋 *Welcome to ZimEduFinder*",
          "",
          "Choose an option:",
          "",
          "1️⃣ Find Schools",
          "2️⃣ Find Private Tutors",
          "3️⃣ I am a Tutor (Register)",
        ].join("\n")
      );
    }

    /* ========== HOME MENU ========== */
    if (user.chatState === "HOME") {
      if (lc === "1") {
        user.chatState = "SCHOOL_SEARCH";
        await user.save();
        return twimlText(
          res,
          [
            "🏫 *Find Schools*",
            "",
            "1️⃣ Harare · Cambridge · Advanced",
            "2️⃣ Harare · Boarding · Primary",
            "3️⃣ Harare · Swimming",
            "",
            "Or type:",
            "find harare cambridge advanced",
          ].join("\n")
        );
      }

      if (lc === "2") {
        user.chatState = "TUTOR_SEARCH";
        await user.save();
        return twimlText(
          res,
          [
            "👩‍🏫 *Find a Tutor*",
            "",
            "1️⃣ Mathematics",
            "2️⃣ Sciences",
            "3️⃣ Commercial Subjects",
            "4️⃣ Languages",
            "5️⃣ ICT",
          ].join("\n")
        );
      }

      if (lc === "3") {
        user.chatState = "TUTOR_NAME";
        user.tutorDraft = { phone };
        await user.save();
        return twimlText(res, "📝 Tutor Registration\n\nWhat is your *full name*?");
      }

      return twimlText(res, "Please reply with 1, 2 or 3.");
    }

    /* ========== SCHOOL SEARCH ========== */
    if (user.chatState === "SCHOOL_SEARCH") {
      let command = lc;
      if (lc === "1") command = "find harare cambridge advanced";
      if (lc === "2") command = "find harare boarding primary";
      if (lc === "3") command = "find harare swimming";

      const parts = command.split(/\s+/);
      if (parts[0] !== "find") {
        return twimlText(res, "Invalid option. Type *hi*.");
      }

      const city = parts[1] || "harare";
      const filters = parseFiltersFromWords(parts.slice(2));
      const site = process.env.SITE_URL.replace(/\/$/, "");

      const resp = await axios.post(`${site}/api/recommend`, {
        city: city.charAt(0).toUpperCase() + city.slice(1),
        ...filters,
      });

      const recs = resp.data?.recommendations || [];
      const twiml = new MessagingResponse();
      let pinned = false;

      for (const r of recs.slice(0, 5)) {
        twiml.message(`🏫 ${r.name}\n${r.website || ""}`);
        if (/st[\s-]*eurit/i.test(r.name)) pinned = true;
      }

      if (pinned) {
        const m = twiml.message(
          "⭐ *Pinned: St Eurit International School*\n👉 https://skoolfinder.net/register/st-eurit-international-school"
        );
        m.media(`${site}/docs/st-eurit.jpg`);
        m.media(`${site}/docs/st-eurit-registration.pdf`);
      }

      user.chatState = "HOME";
      await user.save();

      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    /* ========== TUTOR SEARCH ========== */
    if (user.chatState === "TUTOR_SEARCH") {
      const cat = SUBJECT_CATEGORIES[lc];
      if (!cat) return twimlText(res, "Choose 1–5.");

      const tutors = await Tutor.find({
        subjects: { $in: cat.subjects },
        verified: true,
      }).limit(5);

      user.chatState = "HOME";
      await user.save();

      if (!tutors.length) {
        return twimlText(res, "No tutors found yet.");
      }

      return twimlText(
        res,
        tutors
          .map(
            t =>
              `👤 ${t.name}\n📚 ${t.subjects.join(", ")}\n📍 ${t.city}\n📞 ${t.phone}`
          )
          .join("\n\n")
      );
    }

    /* ========== TUTOR REGISTRATION FLOW ========== */

    const d = user.tutorDraft || {};

    if (user.chatState === "TUTOR_NAME") {
      d.name = Body;
      user.chatState = "TUTOR_SUBJECTS";
      user.tutorDraft = d;
      await user.save();

      return twimlText(
        res,
        [
          "📚 Subjects you teach:",
          "1️⃣ Mathematics",
          "2️⃣ Sciences",
          "3️⃣ Commercial Subjects",
          "4️⃣ Languages",
          "5️⃣ ICT",
        ].join("\n")
      );
    }

    if (user.chatState === "TUTOR_SUBJECTS") {
      const cat = SUBJECT_CATEGORIES[lc];
      if (!cat) return twimlText(res, "Choose 1–5.");

      d.subjects = cat.subjects;
      user.chatState = "TUTOR_LEVELS";
      user.tutorDraft = d;
      await user.save();

      return twimlText(
        res,
        [
          "🎓 Levels:",
          "1️⃣ Primary",
          "2️⃣ High School",
          "3️⃣ Both",
        ].join("\n")
      );
    }

    if (user.chatState === "TUTOR_LEVELS") {
      d.levels =
        lc === "1" ? ["Primary"] : lc === "2" ? ["High School"] : ["Primary", "High School"];

      user.chatState = "TUTOR_MODE";
      user.tutorDraft = d;
      await user.save();

      return twimlText(
        res,
        [
          "🏠 Teaching mode:",
          "1️⃣ In-person",
          "2️⃣ Online",
          "3️⃣ Both",
        ].join("\n")
      );
    }

    if (user.chatState === "TUTOR_MODE") {
      d.mode = lc === "1" ? "in-person" : lc === "2" ? "online" : "both";
      user.chatState = "TUTOR_CITY";
      user.tutorDraft = d;
      await user.save();

      return twimlText(res, "📍 Which city are you based in?");
    }

    if (user.chatState === "TUTOR_CITY") {
      d.city = Body;

      await Tutor.create({
        name: d.name,
        phone: phone,
        subjects: d.subjects,
        levels: d.levels,
        mode: d.mode,
        city: d.city,
        verified: false,
      });

      user.chatState = "HOME";
      user.tutorDraft = {};
      await user.save();

      return twimlText(
        res,
        "✅ *Registration complete!*\nYour profile is pending verification."
      );
    }

    return twimlText(res, "Type *hi* to start.");
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return twimlText(res, "Something went wrong. Type *hi*.");
  }
});

export default router;
