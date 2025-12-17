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

/* ================= CONSTANTS ================= */

const SUBJECT_CATEGORIES = {
  "1": { name: "Mathematics", subjects: ["Mathematics"] },
  "2": { name: "Sciences", subjects: ["Physics", "Chemistry", "Biology"] },
  "3": { name: "Commercials", subjects: ["Accounting", "Business Studies", "Economics"] },
  "4": { name: "Languages", subjects: ["English", "Shona", "Ndebele"] },
  "5": { name: "ICT", subjects: ["Computer Science", "ICT"] },
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

    /* ========== HOME ========== */
    if (user.chatState === "HOME") {
      if (lc === "3") {
        user.chatState = "TUTOR_NAME";
        user.tutorDraft = {};
        await user.save();
        return sendTwiml(res, "📝 *Tutor Registration*\n\nWhat is your full name?");
      }
      return sendTwiml(res, "Please reply with 1, 2 or 3.");
    }

    /* ========== TUTOR REGISTRATION FLOW ========== */

    // Always ensure draft exists
    user.tutorDraft = user.tutorDraft || {};

    if (user.chatState === "TUTOR_NAME") {
      user.tutorDraft.name = Body;
      user.chatState = "TUTOR_SUBJECTS";
      await user.save();

      return sendTwiml(
        res,
        [
          "📚 *Subjects you teach* (reply with a number):",
          "1️⃣ Mathematics",
          "2️⃣ Sciences",
          "3️⃣ Commercials (Accounts, Business, Economics)",
          "4️⃣ Languages",
          "5️⃣ ICT",
        ].join("\n")
      );
    }

    if (user.chatState === "TUTOR_SUBJECTS") {
      const choice = SUBJECT_CATEGORIES[Body];
      if (!choice) return sendTwiml(res, "Please choose a valid number.");

      user.tutorDraft.subjects = choice.subjects;
      user.chatState = "TUTOR_LEVELS";
      await user.save();

      return sendTwiml(
        res,
        [
          "🎓 *Levels you teach*:",
          "1️⃣ Primary",
          "2️⃣ High School",
          "3️⃣ A Level",
        ].join("\n")
      );
    }

    if (user.chatState === "TUTOR_LEVELS") {
      const level = LEVELS[Body];
      if (!level) return sendTwiml(res, "Please choose a valid number.");

      user.tutorDraft.levels = [level];
      user.chatState = "TUTOR_MODE";
      await user.save();

      return sendTwiml(
        res,
        [
          "🏫 *Teaching mode*:",
          "1️⃣ In-person",
          "2️⃣ Online",
          "3️⃣ Both",
        ].join("\n")
      );
    }

    if (user.chatState === "TUTOR_MODE") {
      const mode = MODES[Body];
      if (!mode) return sendTwiml(res, "Please choose a valid number.");

      user.tutorDraft.mode = mode;
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
