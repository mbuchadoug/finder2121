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
  return String(p || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\D+/g, "");
}

/* ================= SCHOOL FILTER PARSER (UNCHANGED) ================= */

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

/* ================= TUTOR CONSTANTS ================= */

const SUBJECT_CATEGORIES = {
  "1": ["Mathematics"],
  "2": ["Physics", "Chemistry", "Biology"],
  "3": ["Accounting", "Business Studies", "Economics"],
  "4": ["English", "Shona", "Ndebele"],
  "5": ["ICT", "Computer Science"],
};

const LEVELS = {
  "1": "Primary",
  "2": "High School",
  "3": "A Level",
};

const MODES = {
  "1": "in-person",
  "2": "online",
  "3": "both",
};

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

    /* ========== GLOBAL RESET ========== */
    if (["hi", "menu", "home", "start"].includes(lc)) {
      user.chatState = "HOME";
      user.tutorDraft = {};
      user.markModified("tutorDraft");
      await user.save();

      return sendTwiml(
        res,
        [
          "👋 *Welcome to ZimEduFinder*",
          "",
          "What would you like to do?",
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
        user.chatState = "SCHOOLS_MENU";
        await user.save();

        return sendTwiml(
          res,
          [
            "🏫 *Find Schools*",
            "",
            "1️⃣ Harare · Cambridge · Advanced",
            "2️⃣ Harare · Boarding · Primary",
            "3️⃣ Harare · Swimming",
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
            "1️⃣ Maths (Primary)",
            "2️⃣ Maths (High School)",
            "3️⃣ Sciences (High School)",
            "4️⃣ Commercial Subjects",
          ].join("\n")
        );
      }

      if (lc === "3") {
        user.chatState = "TUTOR_NAME";
        user.tutorDraft = {};
        user.markModified("tutorDraft");
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
      const city = words[1] || "harare";
      const filters = parseFiltersFromWords(words.slice(2));

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
      let subjects = [];
      if (lc === "1") subjects = ["Mathematics"];
      if (lc === "2") subjects = ["Mathematics"];
      if (lc === "3") subjects = ["Physics", "Chemistry", "Biology"];
      if (lc === "4") subjects = ["Accounting", "Business Studies", "Economics"];

      const tutors = await Tutor.find({
        subjects: { $in: subjects },
      }).limit(5);

      user.chatState = "HOME";
      await user.save();

      if (!tutors.length) {
        return sendTwiml(res, "No tutors found. Try again.");
      }

      return sendTwiml(
        res,
        tutors
          .map(
            t =>
              `👤 ${t.name}\n📚 ${t.subjects.join(", ")}\n📍 ${t.city}\n📞 ${t.phone}`
          )
          .join("\n\n")
      );
    }

    /* ========== TUTOR REGISTRATION FLOW (FIXED) ========== */

    if (user.chatState === "TUTOR_NAME") {
      user.tutorDraft.name = Body;
      user.markModified("tutorDraft");
      user.chatState = "TUTOR_SUBJECTS";
      await user.save();

      return sendTwiml(
        res,
        [
          "📚 *Subjects you teach:*",
          "1️⃣ Mathematics",
          "2️⃣ Sciences",
          "3️⃣ Commercial Subjects",
          "4️⃣ Languages",
          "5️⃣ ICT",
        ].join("\n")
      );
    }

    if (user.chatState === "TUTOR_SUBJECTS") {
      if (!SUBJECT_CATEGORIES[Body]) return sendTwiml(res, "Choose a valid number.");

      user.tutorDraft.subjects = SUBJECT_CATEGORIES[Body];
      user.markModified("tutorDraft");
      user.chatState = "TUTOR_LEVELS";
      await user.save();

      return sendTwiml(
        res,
        ["🎓 *Levels you teach:*", "1️⃣ Primary", "2️⃣ High School", "3️⃣ A Level"].join("\n")
      );
    }

    if (user.chatState === "TUTOR_LEVELS") {
      if (!LEVELS[Body]) return sendTwiml(res, "Choose a valid number.");

      user.tutorDraft.levels = [LEVELS[Body]];
      user.markModified("tutorDraft");
      user.chatState = "TUTOR_MODE";
      await user.save();

      return sendTwiml(
        res,
        ["🏫 *Teaching mode:*", "1️⃣ In-person", "2️⃣ Online", "3️⃣ Both"].join("\n")
      );
    }

    if (user.chatState === "TUTOR_MODE") {
      if (!MODES[Body]) return sendTwiml(res, "Choose a valid number.");

      user.tutorDraft.mode = MODES[Body];
      user.markModified("tutorDraft");
      user.chatState = "TUTOR_CITY";
      await user.save();

      return sendTwiml(res, "📍 Which city are you based in?");
    }

    if (user.chatState === "TUTOR_CITY") {
      const d = user.tutorDraft;

      await Tutor.create({
        name: d.name,
        phone: providerId,
        subjects: d.subjects,
        levels: d.levels,
        mode: d.mode,
        city: Body,
        verified: false,
      });

      user.chatState = "HOME";
      user.tutorDraft = {};
      user.markModified("tutorDraft");
      await user.save();

      return sendTwiml(
        res,
        "✅ *Registration complete!*\nYour tutor profile has been saved and is pending verification."
      );
    }

    return sendTwiml(res, "Type *hi* to start.");
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendTwiml(res, "Something went wrong. Type *hi* to restart.");
  }
});

export default router;
