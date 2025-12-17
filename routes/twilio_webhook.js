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

/* ================= SCHOOL FILTERS (UNCHANGED LOGIC) ================= */

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

  for (const raw of words) {
    const w = raw.toLowerCase();

    if (w === "cambridge") add(filters.curriculum, "Cambridge");
    if (w === "zimsec") add(filters.curriculum, "Zimsec");
    if (w === "ib") add(filters.curriculum, "IB");

    if (w === "boarding") add(filters.type2, "Boarding");
    if (w === "day") add(filters.type2, "Day");

    if (w === "primary") add(filters.schoolPhase, "Primary School");
    if (w === "high") add(filters.schoolPhase, "High School");
    if (w === "pre") add(filters.schoolPhase, "Pre-School");

    if (w === "advanced") filters.learningEnvironment = "Advanced";
    if (w === "enhanced") filters.learningEnvironment = "Enhanced";
    if (w === "comprehensive") filters.learningEnvironment = "Comprehensive";

    if (w === "girls") filters.gender = "Girls";
    if (w === "boys") filters.gender = "Boys";
    if (w === "mixed") filters.gender = "Mixed";

    if (w === "swimming") add(filters.facilities, "swimmingPool");
    if (w === "computer") add(filters.facilities, "computerLab");
    if (w === "science") add(filters.facilities, "scienceLabs");
    if (w === "library") add(filters.facilities, "library");
    if (w === "aftercare") add(filters.facilities, "aftercare");
  }

  return filters;
}

/* ================= CONSTANT MENUS ================= */

const HOME_MENU = [
  "👋 *Welcome to ZimEduFinder*",
  "",
  "What would you like to do?",
  "",
  "1️⃣ Find Schools",
  "2️⃣ Find Private Tutors",
  "3️⃣ I am a Tutor (Register)",
].join("\n");

const TUTOR_CATEGORY_MENU = [
  "📚 *Select your teaching category:*",
  "",
  "1️⃣ Maths",
  "2️⃣ Sciences",
  "3️⃣ Languages",
  "4️⃣ Commercial Subjects",
  "5️⃣ ICT / Computer Studies",
  "6️⃣ Exam Preparation",
].join("\n");

const TUTOR_LEVEL_MENU = [
  "🎓 *Select level(s):*",
  "",
  "1️⃣ Primary",
  "2️⃣ High School",
  "3️⃣ Both",
].join("\n");

const TUTOR_MODE_MENU = [
  "🏫 *Teaching mode:*",
  "",
  "1️⃣ In-person",
  "2️⃣ Online",
  "3️⃣ Both",
].join("\n");

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
        tutorDraft: {},
      });
    }

    // 🔒 HARD SAFETY
    if (!user.tutorDraft) user.tutorDraft = {};

    /* ========== RESET / HOME ========== */
    if (["hi", "menu", "home", "start"].includes(lc)) {
      user.chatState = "HOME";
      user.tutorDraft = {};
      await user.save();
      return sendTwiml(res, HOME_MENU);
    }

    /* ========== HOME MENU ========== */
    if (user.chatState === "HOME") {
      if (lc === "1") {
        user.chatState = "SCHOOLS_MENU";
        await user.save();
        return sendTwiml(
          res,
          [
            "🏫 *Find Schools*",
            "",
            "Reply with:",
            "1️⃣ Harare · Cambridge · Advanced",
            "2️⃣ Harare · Boarding · Primary",
            "3️⃣ Harare · Swimming Schools",
          ].join("\n")
        );
      }

      if (lc === "2") {
        user.chatState = "TUTOR_SEARCH";
        await user.save();
        return sendTwiml(
          res,
          [
            "👩‍🏫 *Find a Tutor*",
            "",
            "Choose subject:",
            "1️⃣ Maths",
            "2️⃣ Sciences",
            "3️⃣ Languages",
            "4️⃣ Commercial Subjects",
            "5️⃣ ICT",
            "6️⃣ Exam Prep",
          ].join("\n")
        );
      }

      if (lc === "3") {
        user.chatState = "TUTOR_REGISTER_NAME";
        user.tutorDraft = {};
        await user.save();
        return sendTwiml(res, "📝 *Tutor Registration*\n\nWhat is your full name?");
      }

      return sendTwiml(res, "Please reply with 1, 2 or 3.");
    }

    /* ========== SCHOOL SEARCH (WORKING LOGIC KEPT) ========== */
    if (user.chatState === "SCHOOLS_MENU") {
      let command = lc;
      if (lc === "1") command = "find harare cambridge advanced";
      if (lc === "2") command = "find harare boarding primary";
      if (lc === "3") command = "find harare swimming";

      const words = command.split(/\s+/);
      if (words[0] !== "find") return sendTwiml(res, "Invalid option.");

      const city = words[1] || "harare";
      const filters = parseFiltersFromWords(words.slice(2));

      const site = process.env.SITE_URL.replace(/\/$/, "");
      const resp = await axios.post(`${site}/api/recommend`, {
        city: city.charAt(0).toUpperCase() + city.slice(1),
        ...filters,
      });

      const recs = resp.data?.recommendations || [];
      if (!recs.length) return sendTwiml(res, "No schools found.");

      const twiml = new MessagingResponse();
      let pinned = false;

      for (const r of recs.slice(0, 5)) {
        twiml.message(`🏫 ${r.name}\n${r.website || ""}`);
        if (/st[\s-]*eurit/i.test(r.name)) pinned = true;
      }

      if (pinned) {
        const msg = twiml.message(
          "⭐ *Pinned School: St Eurit International School*\n👉 https://skoolfinder.net/register/st-eurit-international-school"
        );
        msg.media(`${site}/docs/st-eurit.jpg`);
        msg.media(`${site}/docs/st-eurit-registration.pdf`);
      }

      user.chatState = "HOME";
      await user.save();

      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    /* ========== TUTOR SEARCH ========== */
    if (user.chatState === "TUTOR_SEARCH") {
      const map = {
        "1": "Maths",
        "2": "Science",
        "3": "Language",
        "4": "Commercial",
        "5": "ICT",
        "6": "Exam",
      };

      const key = map[lc];
      if (!key) return sendTwiml(res, "Choose a valid option.");

      const tutors = await Tutor.find({
        subjects: { $regex: key, $options: "i" },
      }).limit(5);

      if (!tutors.length) return sendTwiml(res, "No tutors found.");

      user.chatState = "HOME";
      await user.save();

      return sendTwiml(
        res,
        tutors.map(t => `👤 ${t.name}\n📞 ${t.phone}\n📍 ${t.city}`).join("\n\n")
      );
    }

    /* ========== TUTOR REGISTRATION (SMART FORM) ========== */

    if (user.chatState === "TUTOR_REGISTER_NAME") {
      user.tutorDraft.name = Body;
      user.chatState = "TUTOR_REGISTER_CATEGORY";
      await user.save();
      return sendTwiml(res, TUTOR_CATEGORY_MENU);
    }

    if (user.chatState === "TUTOR_REGISTER_CATEGORY") {
      const cats = {
        "1": "Maths",
        "2": "Sciences",
        "3": "Languages",
        "4": "Commercial Subjects",
        "5": "ICT",
        "6": "Exam Prep",
      };
      user.tutorDraft.subjects = [cats[lc]];
      user.chatState = "TUTOR_REGISTER_LEVEL";
      await user.save();
      return sendTwiml(res, TUTOR_LEVEL_MENU);
    }

    if (user.chatState === "TUTOR_REGISTER_LEVEL") {
      user.tutorDraft.levels =
        lc === "3" ? ["Primary", "High School"] : [lc === "1" ? "Primary" : "High School"];
      user.chatState = "TUTOR_REGISTER_MODE";
      await user.save();
      return sendTwiml(res, TUTOR_MODE_MENU);
    }

    if (user.chatState === "TUTOR_REGISTER_MODE") {
      user.tutorDraft.mode = lc === "1" ? "in-person" : lc === "2" ? "online" : "both";
      user.chatState = "TUTOR_REGISTER_CITY";
      await user.save();
      return sendTwiml(res, "📍 Which city are you based in?");
    }

    if (user.chatState === "TUTOR_REGISTER_CITY") {
      user.tutorDraft.city = Body;
      user.tutorDraft.phone = providerId;

      await Tutor.create(user.tutorDraft);

      user.chatState = "HOME";
      user.tutorDraft = {};
      await user.save();

      return sendTwiml(res, "✅ *Tutor registration complete!*");
    }

    return sendTwiml(res, "Type *hi* to start.");
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendTwiml(res, "Something went wrong. Type *hi* to restart.");
  }
});

export default router;
