// routes/twilio_webhook.js
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

/* ================= FILTER PARSER (UNCHANGED) ================= */

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

    /* ========== GLOBAL RESET (CRITICAL) ========== */
    if (["hi", "menu", "home", "start"].includes(lc)) {
      user.chatState = "HOME";
      user.tutorDraft = null;
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
            "Reply with a number:",
            "1️⃣ Harare · Cambridge · Advanced",
            "2️⃣ Harare · Boarding · Primary",
            "3️⃣ Harare · Swimming · Family schools",
            "",
            "Or type: find harare cambridge advanced",
          ].join("\n")
        );
      }

      if (lc === "2") {
        user.chatState = "TUTOR_SEARCH";
        await user.save();

        return sendTwiml(
          res,
          [
            "👩‍🏫 *Find a Private Tutor*",
            "",
            "Reply with:",
            "1️⃣ Maths (Primary)",
            "2️⃣ Maths (High School)",
            "3️⃣ Science (High School)",
            "4️⃣ English (Primary)",
          ].join("\n")
        );
      }

      if (lc === "3") {
        user.chatState = "TUTOR_REGISTER_NAME";
        user.tutorDraft = {};
        await user.save();

        return sendTwiml(
          res,
          "📝 *Tutor Registration*\n\nWhat is your full name?"
        );
      }

      return sendTwiml(res, "Please reply with 1, 2 or 3.");
    }

    /* ========== SCHOOL SEARCH (KEEP WORKING LOGIC) ========== */
    if (user.chatState === "SCHOOLS_MENU") {
      let command = lc;

      if (lc === "1") command = "find harare cambridge advanced";
      if (lc === "2") command = "find harare boarding primary";
      if (lc === "3") command = "find harare swimming";

      const words = command.split(/\s+/);
      if (words[0] !== "find") {
        return sendTwiml(res, "Please choose an option or type a search.");
      }

      const city = words[1] || "harare";
      const filters = parseFiltersFromWords(words.slice(2));

      const site = process.env.SITE_URL.replace(/\/$/, "");

      const resp = await axios.post(`${site}/api/recommend`, {
        city: city.charAt(0).toUpperCase() + city.slice(1),
        ...filters,
      });

      const recs = resp.data?.recommendations || [];
      if (!recs.length) {
        return sendTwiml(res, "No schools found. Try another option.");
      }

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
      let subject = "";

      if (lc === "1") subject = "Maths Primary";
      if (lc === "2") subject = "Maths High School";
      if (lc === "3") subject = "Science High School";
      if (lc === "4") subject = "English Primary";

      const tutors = await Tutor.find({
        subjects: { $regex: subject.split(" ")[0], $options: "i" },
      }).limit(5);

      if (!tutors.length) {
        return sendTwiml(res, "No tutors found. Try another option.");
      }

      const lines = tutors.map(
        t => `👤 ${t.name}\n📞 ${t.phone}\n📍 ${t.city}`
      );

      user.chatState = "HOME";
      await user.save();

      return sendTwiml(res, lines.join("\n\n"));
    }

    /* ========== TUTOR REGISTRATION (SMART FORM) ========== */

    if (user.chatState.startsWith("TUTOR_REGISTER")) {
      const d = user.tutorDraft || {};

      if (user.chatState === "TUTOR_REGISTER_NAME") {
        d.name = Body;
        user.chatState = "TUTOR_REGISTER_PHONE";
        user.tutorDraft = d;
        await user.save();
        return sendTwiml(res, "📞 Your phone number?");
      }

      if (user.chatState === "TUTOR_REGISTER_PHONE") {
        d.phone = Body;
        user.chatState = "TUTOR_REGISTER_SUBJECTS";
        user.tutorDraft = d;
        await user.save();
        return sendTwiml(res, "📚 Subjects you teach? (comma separated)");
      }

      if (user.chatState === "TUTOR_REGISTER_SUBJECTS") {
        d.subjects = Body.split(",").map(s => s.trim());
        user.chatState = "TUTOR_REGISTER_CITY";
        user.tutorDraft = d;
        await user.save();
        return sendTwiml(res, "📍 City?");
      }

      if (user.chatState === "TUTOR_REGISTER_CITY") {
        d.city = Body;

        await Tutor.create(d);
        user.chatState = "HOME";
        user.tutorDraft = null;
        await user.save();

        return sendTwiml(
          res,
          "✅ *Registration complete!*\nYour profile will be reviewed."
        );
      }
    }

    return sendTwiml(res, "Type *hi* to start.");
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendTwiml(res, "Something went wrong. Type *hi* to restart.");
  }
});

export default router;
