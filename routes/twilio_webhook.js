import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";
import Tutor from "../models/tutor.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------- Helpers ---------- */

function sendTwiml(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(p) {
  return String(p || "").replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

/* ---------- MENUS ---------- */

const MAIN_MENU = `
👋 Welcome to *ZimEduFinder*

What are you looking for?

1️⃣ Find Schools
2️⃣ Find Private Tutors
3️⃣ Register as a Tutor
`;

const TUTOR_MENU = `
👨‍🏫 *Private Tutors*

Choose an option:

1️⃣ Find a Tutor
2️⃣ Register as a Tutor
3️⃣ Back to Main Menu
`;

/* ---------- WEBHOOK ---------- */

router.post("/webhook", async (req, res) => {
  try {
    const { From, Body, ProfileName } = req.body;
    if (!From) return sendTwiml(res, "Missing sender");

    const providerId = From.replace(/^whatsapp:/i, "");
    const phone = normalizePhone(providerId);
    const text = (Body || "").trim();

    let user = await User.findOne({ provider: "whatsapp", providerId });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        phone,
        name: ProfileName,
        chatState: "MENU",
        tutorDraft: {},
      });
    }

    /* ---------- GLOBAL RESET ---------- */
    if (/^(hi|menu|start)$/i.test(text)) {
      user.chatState = "MENU";
      await user.save();
      return sendTwiml(res, MAIN_MENU);
    }

    /* ---------- MAIN MENU ---------- */
    if (user.chatState === "MENU") {
      if (text === "1") {
        // KEEP YOUR EXISTING SCHOOL LOGIC
        return sendTwiml(
          res,
          "🏫 School search is ready.\nType your search or use numbered options."
        );
      }

      if (text === "2") {
        user.chatState = "TUTOR_MENU";
        await user.save();
        return sendTwiml(res, TUTOR_MENU);
      }

      if (text === "3") {
        user.chatState = "TUTOR_REGISTER_NAME";
        await user.save();
        return sendTwiml(
          res,
          "👨‍🏫 Tutor Registration\n\nWhat is your *full name*?"
        );
      }

      return sendTwiml(res, MAIN_MENU);
    }

    /* ---------- TUTOR MENU ---------- */
    if (user.chatState === "TUTOR_MENU") {
      if (text === "1") {
        const tutors = await Tutor.find({ verified: true }).limit(5);

        if (!tutors.length) {
          return sendTwiml(res, "No tutors found yet.");
        }

        const lines = tutors.map(
          t =>
            `👨‍🏫 ${t.name}\n📚 ${t.subjects.join(", ")}\n📍 ${t.city}\n📞 ${t.phone}`
        );

        return sendTwiml(res, lines.join("\n\n"));
      }

      if (text === "2") {
        user.chatState = "TUTOR_REGISTER_NAME";
        user.tutorDraft = {};
        await user.save();
        return sendTwiml(res, "👨‍🏫 Tutor Registration\n\nWhat is your *full name*?");
      }

      if (text === "3") {
        user.chatState = "MENU";
        await user.save();
        return sendTwiml(res, MAIN_MENU);
      }

      return sendTwiml(res, TUTOR_MENU);
    }

    /* ---------- SMART FORM: REGISTER TUTOR ---------- */

    if (user.chatState === "TUTOR_REGISTER_NAME") {
      user.tutorDraft.name = text;
      user.chatState = "TUTOR_REGISTER_SUBJECTS";
      await user.save();
      return sendTwiml(
        res,
        "📚 What subjects do you teach?\nExample: Maths, English, Physics"
      );
    }

    if (user.chatState === "TUTOR_REGISTER_SUBJECTS") {
      user.tutorDraft.subjects = text.split(",").map(s => s.trim());
      user.chatState = "TUTOR_REGISTER_LEVELS";
      await user.save();
      return sendTwiml(
        res,
        "🎓 What levels?\nPrimary / Secondary / A-Level"
      );
    }

    if (user.chatState === "TUTOR_REGISTER_LEVELS") {
      user.tutorDraft.levels = text.split(",").map(l => l.trim());
      user.chatState = "TUTOR_REGISTER_MODE";
      await user.save();
      return sendTwiml(
        res,
        "🏠 Teaching mode?\n1️⃣ In-person\n2️⃣ Online\n3️⃣ Both"
      );
    }

    if (user.chatState === "TUTOR_REGISTER_MODE") {
      user.tutorDraft.mode =
        text === "1" ? "in-person" : text === "2" ? "online" : "both";
      user.chatState = "TUTOR_REGISTER_CITY";
      await user.save();
      return sendTwiml(res, "📍 Which city are you based in?");
    }

    if (user.chatState === "TUTOR_REGISTER_CITY") {
      user.tutorDraft.city = text;
      user.chatState = "TUTOR_REGISTER_EXPERIENCE";
      await user.save();
      return sendTwiml(res, "🧠 Years of experience?");
    }

    if (user.chatState === "TUTOR_REGISTER_EXPERIENCE") {
      user.tutorDraft.experience = text;

      await Tutor.create({
        ...user.tutorDraft,
        phone: user.phone,
        verified: false,
      });

      user.chatState = "MENU";
      user.tutorDraft = {};
      await user.save();

      return sendTwiml(
        res,
        "✅ Registration complete!\nYour profile will be reviewed.\n\nType *hi* to continue."
      );
    }

    return sendTwiml(res, MAIN_MENU);
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendTwiml(res, "Something went wrong. Type *hi* to restart.");
  }
});

export default router;
