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
  "📚 *Select your main teaching category:*",
  "",
  "1️⃣ Maths",
  "2️⃣ Sciences",
  "3️⃣ Languages",
  "4️⃣ Commercial Subjects",
  "5️⃣ ICT / Computer Studies",
  "6️⃣ Exam Preparation",
].join("\n");

const TUTOR_LEVEL_MENU = [
  "🎓 *Which level do you teach?*",
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

    const phone = normalizePhone(From);

    let user = await User.findOne({ provider: "whatsapp", providerId: phone });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId: phone,
        phone,
        chatState: "HOME",
        tutorDraft: {},
      });
    }

    if (!user.tutorDraft) user.tutorDraft = {};

    /* ===== RESET ===== */
    if (["hi", "menu", "home", "start"].includes(lc)) {
      user.chatState = "HOME";
      user.tutorDraft = {};
      await user.save();
      return sendTwiml(res, HOME_MENU);
    }

    /* ===== HOME ===== */
    if (user.chatState === "HOME") {
      if (lc === "3") {
        user.chatState = "TUTOR_REGISTER_NAME";
        user.tutorDraft = {};
        await user.save();
        return sendTwiml(res, "📝 *Tutor Registration*\n\nWhat is your full name?");
      }

      if (lc === "2") {
        user.chatState = "TUTOR_SEARCH";
        await user.save();
        return sendTwiml(
          res,
          [
            "👩‍🏫 *Find a Tutor*",
            "",
            "1️⃣ Maths",
            "2️⃣ Sciences",
            "3️⃣ Languages",
            "4️⃣ Commercial Subjects",
            "5️⃣ ICT",
            "6️⃣ Exam Prep",
          ].join("\n")
        );
      }

      return sendTwiml(res, HOME_MENU);
    }

    /* ===== TUTOR REGISTRATION FLOW ===== */

    if (user.chatState === "TUTOR_REGISTER_NAME") {
      user.tutorDraft = {
        ...user.tutorDraft,
        name: Body,
        phone,
      };
      user.chatState = "TUTOR_REGISTER_CATEGORY";
      await user.save();
      return sendTwiml(res, TUTOR_CATEGORY_MENU);
    }

    if (user.chatState === "TUTOR_REGISTER_CATEGORY") {
      const map = {
        "1": "Maths",
        "2": "Sciences",
        "3": "Languages",
        "4": "Commercial Subjects",
        "5": "ICT",
        "6": "Exam Preparation",
      };

      if (!map[lc]) return sendTwiml(res, "Please choose a valid option.");

      user.tutorDraft = {
        ...user.tutorDraft,
        subjects: [map[lc]],
      };

      user.chatState = "TUTOR_REGISTER_LEVEL";
      await user.save();
      return sendTwiml(res, TUTOR_LEVEL_MENU);
    }

    if (user.chatState === "TUTOR_REGISTER_LEVEL") {
      const levels =
        lc === "1" ? ["Primary"] :
        lc === "2" ? ["High School"] :
        lc === "3" ? ["Primary", "High School"] :
        null;

      if (!levels) return sendTwiml(res, "Please choose a valid option.");

      user.tutorDraft = {
        ...user.tutorDraft,
        levels,
      };

      user.chatState = "TUTOR_REGISTER_MODE";
      await user.save();
      return sendTwiml(res, TUTOR_MODE_MENU);
    }

    if (user.chatState === "TUTOR_REGISTER_MODE") {
      const mode =
        lc === "1" ? "in-person" :
        lc === "2" ? "online" :
        lc === "3" ? "both" :
        null;

      if (!mode) return sendTwiml(res, "Please choose a valid option.");

      user.tutorDraft = {
        ...user.tutorDraft,
        mode,
      };

      user.chatState = "TUTOR_REGISTER_CITY";
      await user.save();
      return sendTwiml(res, "📍 Which city are you based in?");
    }

    if (user.chatState === "TUTOR_REGISTER_CITY") {
      const tutorData = {
        ...user.tutorDraft,
        city: Body,
        verified: false,
      };

      await Tutor.create(tutorData);

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
