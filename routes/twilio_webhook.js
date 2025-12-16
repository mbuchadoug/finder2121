// routes/twilio_webhook.js
import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* MENUS                                                              */
/* ------------------------------------------------------------------ */

const MAIN_MENU = `
👋 Hi! Welcome to *ZimEduFinder*

What are you looking for today?

1️⃣ Find Schools
2️⃣ Find Private Tutors
3️⃣ Help
`;

const SCHOOL_MENU = `
🏫 *Find Schools (Quick Picks)*

1️⃣ Cambridge · Advanced academics
2️⃣ Boarding · Secure & enhanced
3️⃣ Sports-focused schools
4️⃣ Primary · Strong academics
5️⃣ Balanced & affordable
6️⃣ Custom search
7️⃣ Back
`;

const TUTOR_MENU = `
👩🏽‍🏫 *Private Tutors*

1️⃣ Find a tutor
2️⃣ Register as a tutor
3️⃣ Back
`;

/* ------------------------------------------------------------------ */
/* SMART PRESET SEARCHES (SCHOOLS)                                     */
/* ------------------------------------------------------------------ */

const SCHOOL_PRESETS = {
  "1": "find harare cambridge advanced library computer science",
  "2": "find harare boarding enhanced wifi cctv power",
  "3": "find harare comprehensive swimming rugby football athletics",
  "4": "find harare primary advanced library science computer",
  "5": "find harare comprehensive aftercare transport",
};

/* ------------------------------------------------------------------ */
/* WEBHOOK                                                            */
/* ------------------------------------------------------------------ */

router.post("/webhook", async (req, res) => {
  try {
    const from = normalizePhone(req.body.From);
    const text = String(req.body.Body || "").trim().toLowerCase();
    const profileName = req.body.ProfileName || "";

    if (!from) return sendTwiml(res, "Missing sender info");

    /* ---------- Load / Create User ---------- */

    let user = await User.findOne({ provider: "whatsapp", providerId: from });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId: from,
        name: profileName || "WhatsApp User",
        role: "user",
        lastState: "MAIN_MENU",
      });
    }

    /* ---------- GLOBAL COMMANDS ---------- */

    if (!text || ["hi", "hello", "menu", "start"].includes(text)) {
      user.lastState = "MAIN_MENU";
      await user.save();
      return sendTwiml(res, MAIN_MENU);
    }

    if (text === "3" && user.lastState === "MAIN_MENU") {
      return sendTwiml(res, MAIN_MENU);
    }

    /* ------------------------------------------------------------------ */
    /* MAIN MENU HANDLER                                                   */
    /* ------------------------------------------------------------------ */

    if (user.lastState === "MAIN_MENU") {
      if (text === "1") {
        user.lastState = "SCHOOL_MENU";
        await user.save();
        return sendTwiml(res, SCHOOL_MENU);
      }

      if (text === "2") {
        user.lastState = "TUTOR_MENU";
        await user.save();
        return sendTwiml(res, TUTOR_MENU);
      }

      return sendTwiml(res, MAIN_MENU);
    }

    /* ------------------------------------------------------------------ */
    /* SCHOOL MENU                                                         */
    /* ------------------------------------------------------------------ */

    if (user.lastState === "SCHOOL_MENU") {
      if (text === "7") {
        user.lastState = "MAIN_MENU";
        await user.save();
        return sendTwiml(res, MAIN_MENU);
      }

      if (text === "6") {
        user.lastState = "CUSTOM_SEARCH";
        await user.save();
        return sendTwiml(
          res,
          "✍️ Type your search like:\nfind harare cambridge boarding swimming"
        );
      }

      if (SCHOOL_PRESETS[text]) {
        const command = SCHOOL_PRESETS[text];
        return handleSchoolSearch(command, user, res);
      }

      return sendTwiml(res, SCHOOL_MENU);
    }

    /* ------------------------------------------------------------------ */
    /* CUSTOM SEARCH                                                       */
    /* ------------------------------------------------------------------ */

    if (user.lastState === "CUSTOM_SEARCH") {
      if (!text.startsWith("find")) {
        return sendTwiml(
          res,
          "❗ Please start with *find*\nExample:\nfind harare primary"
        );
      }
      return handleSchoolSearch(text, user, res);
    }

    /* ------------------------------------------------------------------ */
    /* TUTOR MENU                                                          */
    /* ------------------------------------------------------------------ */

    if (user.lastState === "TUTOR_MENU") {
      if (text === "3") {
        user.lastState = "MAIN_MENU";
        await user.save();
        return sendTwiml(res, MAIN_MENU);
      }

      if (text === "1") {
        return sendTwiml(
          res,
          "🔎 Tutor search coming soon.\nWe’re onboarding verified tutors."
        );
      }

      if (text === "2") {
        user.lastState = "TUTOR_REGISTER_1";
        await user.save();
        return sendTwiml(
          res,
          "👩🏽‍🏫 Tutor Registration\n\n1️⃣ Your full name?"
        );
      }

      return sendTwiml(res, TUTOR_MENU);
    }

    /* ------------------------------------------------------------------ */
    /* TUTOR SMART FORM (STEP-BY-STEP)                                     */
    /* ------------------------------------------------------------------ */

    if (user.lastState?.startsWith("TUTOR_REGISTER")) {
      return handleTutorRegistration(user, text, res);
    }

    return sendTwiml(res, MAIN_MENU);
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendTwiml(res, "Something went wrong. Please try again.");
  }
});

/* ------------------------------------------------------------------ */
/* SCHOOL SEARCH HANDLER                                               */
/* ------------------------------------------------------------------ */

async function handleSchoolSearch(command, user, res) {
  const site = process.env.SITE_URL?.replace(/\/$/, "");
  if (!site) return sendTwiml(res, "Search unavailable.");

  const words = command.split(/\s+/);
  const city = words[1] || "Harare";

  try {
    const resp = await axios.post(`${site}/api/recommend`, {
      city,
      rawCommand: command,
    });

    const recs = resp.data?.recommendations || [];

    if (!recs.length) {
      return sendTwiml(
        res,
        "No schools found. Try another option or remove some filters."
      );
    }

    const lines = [`🏫 Top schools in ${city}:`];

    recs.slice(0, 5).forEach((r, i) => {
      lines.push(`\n${i + 1}. ${r.name}`);
      if (r.website) lines.push(`   🌐 ${r.website}`);
    });

    lines.push("\nReply *menu* to search again.");

    return sendTwiml(res, lines.join("\n"));
  } catch (e) {
    console.error("SEARCH ERROR:", e.message);
    return sendTwiml(res, "Search failed. Try again.");
  }
}

/* ------------------------------------------------------------------ */
/* TUTOR REGISTRATION (SMART FORM)                                     */
/* ------------------------------------------------------------------ */

async function handleTutorRegistration(user, text, res) {
  const step = user.lastState;

  user.tutorProfile = user.tutorProfile || {};

  if (step === "TUTOR_REGISTER_1") {
    user.tutorProfile.name = text;
    user.lastState = "TUTOR_REGISTER_2";
    await user.save();
    return sendTwiml(res, "2️⃣ Subjects you teach? (e.g. Math, English)");
  }

  if (step === "TUTOR_REGISTER_2") {
    user.tutorProfile.subjects = text;
    user.lastState = "TUTOR_REGISTER_3";
    await user.save();
    return sendTwiml(res, "3️⃣ Levels? (Primary / Secondary / A-Level)");
  }

  if (step === "TUTOR_REGISTER_3") {
    user.tutorProfile.levels = text;
    user.lastState = "TUTOR_REGISTER_4";
    await user.save();
    return sendTwiml(res, "4️⃣ City / area?");
  }

  if (step === "TUTOR_REGISTER_4") {
    user.tutorProfile.city = text;
    user.lastState = "MAIN_MENU";
    await user.save();

    return sendTwiml(
      res,
      "✅ Tutor profile submitted!\nWe’ll review and notify you once approved.\n\nType *menu* to continue."
    );
  }
}

export default router;
