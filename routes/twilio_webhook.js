import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------------- helpers ---------------- */

function send(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(p) {
  return String(p || "").replace(/^whatsapp:/, "").replace(/\D+/g, "");
}

/* ---------------- menus ---------------- */

const MAIN_MENU = `
👋 *Welcome to ZimEduFinder*

What are you looking for today?

1️⃣ Find Schools
2️⃣ Find Private Tutors
3️⃣ Help
`;

const SCHOOL_MENU = `
🏫 *Find Schools*

Choose a quick option:

1️⃣ Cambridge · Advanced · Harare
2️⃣ Boarding · Swimming Pool
3️⃣ Primary · Enhanced
4️⃣ Transport + WiFi
5️⃣ Back
`;

const TUTOR_MENU = `
👨‍🏫 *Private Tutors*

1️⃣ Find a Tutor
2️⃣ I am a Tutor (Register)
3️⃣ Back
`;

const HELP_TEXT = `
ℹ️ *ZimEduFinder Help*

• Reply with numbers to navigate
• No typing needed
• Smart recommendations

Reply *menu* anytime to restart.
`;

/* ---------------- webhook ---------------- */

router.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const from = body.From;
    const text = (body.Body || "").trim();
    const lc = text.toLowerCase();

    if (!from) return send(res, "Missing sender");

    const providerId = normalizePhone(from);

    let user = await User.findOne({ provider: "whatsapp", providerId });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        name: body.ProfileName || "",
      });
    }

    /* ---------- global shortcuts ---------- */

    if (!text || ["hi", "hello", "menu"].includes(lc)) {
      user.chatState = "WELCOME";
      await user.save();
      return send(res, MAIN_MENU);
    }

    if (lc === "help") return send(res, HELP_TEXT);

    /* ---------- state machine ---------- */

    switch (user.chatState) {

      /* ===== WELCOME ===== */
      case "WELCOME":
        if (text === "1") {
          user.chatState = "SCHOOL_MENU";
          await user.save();
          return send(res, SCHOOL_MENU);
        }
        if (text === "2") {
          user.chatState = "TUTOR_MENU";
          await user.save();
          return send(res, TUTOR_MENU);
        }
        if (text === "3") return send(res, HELP_TEXT);

        return send(res, MAIN_MENU);

      /* ===== SCHOOL QUICK SEARCH ===== */
      case "SCHOOL_MENU": {
        let command = null;

        if (text === "1")
          command = "find harare cambridge advanced";
        if (text === "2")
          command = "find harare boarding swimming";
        if (text === "3")
          command = "find harare primary enhanced";
        if (text === "4")
          command = "find harare transport wifi";
        if (text === "5") {
          user.chatState = "WELCOME";
          await user.save();
          return send(res, MAIN_MENU);
        }

        if (!command) return send(res, SCHOOL_MENU);

        // 🔥 reuse existing search API
        user.chatState = "WELCOME";
        await user.save();

        const site = process.env.SITE_URL.replace(/\/$/, "");

        const resp = await axios.post(`${site}/api/recommend`, {
          city: "Harare",
          curriculum: command.includes("cambridge") ? ["Cambridge"] : [],
          type2: command.includes("boarding") ? ["Boarding"] : [],
          schoolPhase: command.includes("primary") ? ["Primary School"] : [],
          learningEnvironment: command.includes("advanced")
            ? "Advanced"
            : command.includes("enhanced")
            ? "Enhanced"
            : undefined,
          facilities: [
            command.includes("swimming") && "swimmingPool",
            command.includes("wifi") && "wifiCampus",
            command.includes("transport") && "transportBuses",
          ].filter(Boolean),
        });

        const schools = resp.data?.recommendations || [];

        if (!schools.length)
          return send(res, "No schools found. Try another option.");

        let msg = `🎓 *Top schools for you:*\n`;

        schools.slice(0, 5).forEach((s, i) => {
          msg += `\n${i + 1}. ${s.name}\n   ${s.website || ""}`;
        });

        return send(res, msg);
      }

      /* ===== TUTOR MENU ===== */
      case "TUTOR_MENU":
        if (text === "1") {
          return send(
            res,
            "🔍 Tutor search coming soon.\nReply 3 to go back."
          );
        }

        if (text === "2") {
          user.chatState = "TUTOR_SUBJECT";
          await user.save();
          return send(res, "📘 What subject do you teach?");
        }

        if (text === "3") {
          user.chatState = "WELCOME";
          await user.save();
          return send(res, MAIN_MENU);
        }

        return send(res, TUTOR_MENU);

      /* ===== TUTOR SMART FORM ===== */
      case "TUTOR_SUBJECT":
        user.tutorProfile.subject = text;
        user.chatState = "TUTOR_LEVEL";
        await user.save();
        return send(res, "🎓 Which level? (Primary / Secondary / A-Level)");

      case "TUTOR_LEVEL":
        user.tutorProfile.level = text;
        user.chatState = "TUTOR_CITY";
        await user.save();
        return send(res, "📍 Which city are you based in?");

      case "TUTOR_CITY":
        user.tutorProfile.city = text;
        user.tutorProfile.phone = providerId;
        user.chatState = "WELCOME";
        await user.save();

        return send(
          res,
          "✅ *Registration complete!*\nWe’ll contact you when parents need your subject."
        );

      default:
        user.chatState = "WELCOME";
        await user.save();
        return send(res, MAIN_MENU);
    }

  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return send(res, "Something went wrong. Send *menu* to restart.");
  }
});

export default router;
