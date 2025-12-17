import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

import User from "../models/user.js";
import Tutor from "../models/tutor.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ================= HELPERS ================= */

function sendTwiml(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(p) {
  return String(p || "").replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

/* ================= SUBJECT DEFINITIONS ================= */

const SUBJECT_CATEGORIES = {
  SCIENCES: ["Maths", "Physics", "Chemistry", "Biology"],
  COMMERCIAL: ["Accounting", "Business Studies", "Economics", "Commerce"],
  LANGUAGES: ["English", "Shona", "Ndebele", "French"],
  ICT: ["ICT", "Computer Science", "Coding"],
  HUMANITIES: ["Geography", "History", "Religious Studies"],
  EARLY: ["ECD", "Phonics", "Numeracy"],
};

const CATEGORY_MENU = [
  "📚 *Choose a subject category:*",
  "",
  "1️⃣ Sciences",
  "2️⃣ Commercial Subjects",
  "3️⃣ Languages",
  "4️⃣ ICT & Technology",
  "5️⃣ Humanities",
  "6️⃣ Early Learning",
].join("\n");

const CATEGORY_MAP = {
  "1": "SCIENCES",
  "2": "COMMERCIAL",
  "3": "LANGUAGES",
  "4": "ICT",
  "5": "HUMANITIES",
  "6": "EARLY",
};

function subjectMenu(categoryKey) {
  const subjects = SUBJECT_CATEGORIES[categoryKey];
  return [
    "📖 *Select subjects* (comma separated)",
    "",
    ...subjects.map((s, i) => `${i + 1}️⃣ ${s}`),
    "",
    "Example: 1,3",
  ].join("\n");
}

/* ================= SCHOOL FILTER PARSER (UNCHANGED – WORKING) ================= */

function parseFiltersFromWords(words) {
  const filters = {
    curriculum: [],
    type2: [],
    schoolPhase: [],
    learningEnvironment: "",
    gender: "",
    facilities: [],
  };

  const add = (arr, v) => !arr.includes(v) && arr.push(v);

  for (const w of words) {
    if (w === "cambridge") add(filters.curriculum, "Cambridge");
    if (w === "zimsec") add(filters.curriculum, "Zimsec");

    if (w === "boarding") add(filters.type2, "Boarding");
    if (w === "day") add(filters.type2, "Day");

    if (w === "primary") add(filters.schoolPhase, "Primary School");
    if (w === "high") add(filters.schoolPhase, "High School");

    if (w === "advanced") filters.learningEnvironment = "Advanced";
    if (w === "enhanced") filters.learningEnvironment = "Enhanced";
    if (w === "comprehensive") filters.learningEnvironment = "Comprehensive";

    if (w === "swimming") add(filters.facilities, "swimmingPool");
    if (w === "library") add(filters.facilities, "library");
  }

  return filters;
}

/* ================= MAIN WEBHOOK ================= */

router.post("/webhook", async (req, res) => {
  try {
    const Body = String(req.body.Body || "").trim();
    const lc = Body.toLowerCase();
    const From = req.body.From;

    if (!From) return sendTwiml(res, "Missing sender");

    const providerId = normalizePhone(From);

    let user = await User.findOne({ provider: "whatsapp", providerId });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        phone: providerId,
        chatState: "HOME",
      });
    }

    /* ========== RESET / HOME ========== */
    if (["hi", "menu", "home", "start"].includes(lc)) {
      user.chatState = "HOME";
      user.tutorDraft = null;
      await user.save();

      return sendTwiml(res, [
        "👋 *Welcome to ZimEduFinder*",
        "",
        "What would you like to do?",
        "",
        "1️⃣ Find Schools",
        "2️⃣ Find Private Tutors",
        "3️⃣ I am a Tutor (Register)",
      ].join("\n"));
    }

    /* ========== HOME MENU ========== */
    if (user.chatState === "HOME") {
      if (lc === "1") {
        user.chatState = "SCHOOLS_MENU";
        await user.save();

        return sendTwiml(res, [
          "🏫 *Find Schools*",
          "",
          "1️⃣ Harare · Cambridge · Advanced",
          "2️⃣ Harare · Boarding · Primary",
          "3️⃣ Harare · Schools with Swimming",
        ].join("\n"));
      }

      if (lc === "2") {
        user.chatState = "TUTOR_SEARCH_CATEGORY";
        await user.save();
        return sendTwiml(res, CATEGORY_MENU);
      }

      if (lc === "3") {
        user.chatState = "TUTOR_REGISTER_NAME";
        user.tutorDraft = {};
        await user.save();
        return sendTwiml(res, "📝 *Tutor Registration*\n\nWhat is your full name?");
      }

      return sendTwiml(res, "Please reply with 1, 2 or 3.");
    }

    /* ========== SCHOOL SEARCH (UNTOUCHED LOGIC) ========== */
    if (user.chatState === "SCHOOLS_MENU") {
      let command = "";
      if (lc === "1") command = "find harare cambridge advanced";
      if (lc === "2") command = "find harare boarding primary";
      if (lc === "3") command = "find harare swimming";

      const words = command.split(/\s+/);
      const filters = parseFiltersFromWords(words.slice(2));

      const site = process.env.SITE_URL.replace(/\/$/, "");
      const resp = await axios.post(`${site}/api/recommend`, {
        city: "Harare",
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
          "⭐ *Pinned School: St Eurit International School*\n👉 https://skoolfinder.net/register/st-eurit-international-school"
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
    if (user.chatState === "TUTOR_SEARCH_CATEGORY") {
      user.searchCategory = CATEGORY_MAP[lc];
      user.chatState = "TUTOR_SEARCH_SUBJECT";
      await user.save();
      return sendTwiml(res, subjectMenu(user.searchCategory));
    }

    if (user.chatState === "TUTOR_SEARCH_SUBJECT") {
      const subjects = SUBJECT_CATEGORIES[user.searchCategory];
      const subject = subjects[Number(lc) - 1];

      const tutors = await Tutor.find({
        subjects: subject,
        verified: true,
      }).limit(5);

      user.chatState = "HOME";
      await user.save();

      if (!tutors.length) return sendTwiml(res, "No tutors found.");

      return sendTwiml(
        res,
        tutors.map(t =>
          `👤 ${t.name}\n📞 ${t.phone}\n📍 ${t.city}`
        ).join("\n\n")
      );
    }

    /* ========== TUTOR REGISTRATION SMART FORM ========== */

    if (user.chatState === "TUTOR_REGISTER_NAME") {
      user.tutorDraft.name = Body;
      user.chatState = "TUTOR_REGISTER_CATEGORY";
      await user.save();
      return sendTwiml(res, CATEGORY_MENU);
    }

    if (user.chatState === "TUTOR_REGISTER_CATEGORY") {
      user.tutorDraft.category = CATEGORY_MAP[lc];
      user.chatState = "TUTOR_REGISTER_SUBJECTS";
      await user.save();
      return sendTwiml(res, subjectMenu(user.tutorDraft.category));
    }

    if (user.chatState === "TUTOR_REGISTER_SUBJECTS") {
      const subjects = SUBJECT_CATEGORIES[user.tutorDraft.category];
      user.tutorDraft.subjects = lc.split(",")
        .map(i => subjects[Number(i.trim()) - 1])
        .filter(Boolean);

      user.chatState = "TUTOR_REGISTER_LEVELS";
      await user.save();
      return sendTwiml(res,
        "🎓 Levels taught:\n1️⃣ Primary\n2️⃣ High School\n3️⃣ A-Level\nExample: 2,3"
      );
    }

    if (user.chatState === "TUTOR_REGISTER_LEVELS") {
      const map = { "1": "Primary", "2": "High School", "3": "A-Level" };
      user.tutorDraft.levels = lc.split(",").map(i => map[i.trim()]);
      user.chatState = "TUTOR_REGISTER_CITY";
      await user.save();
      return sendTwiml(res, "📍 City?");
    }

    if (user.chatState === "TUTOR_REGISTER_CITY") {
      user.tutorDraft.city = Body;
      user.tutorDraft.phone = user.phone;

      await Tutor.create(user.tutorDraft);

      user.chatState = "HOME";
      user.tutorDraft = null;
      await user.save();

      return sendTwiml(res,
        "✅ *Registration complete!*\nYour profile will be reviewed."
      );
    }

    return sendTwiml(res, "Type *hi* to start.");
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendTwiml(res, "Something went wrong. Type *hi* to restart.");
  }
});

export default router;
