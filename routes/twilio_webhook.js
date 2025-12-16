// routes/twilio_webhook.js
import express from "express";
import { Router } from "express";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import axios from "axios";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* =====================================================
   Helpers
===================================================== */

function sendTwiml(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(from) {
  return String(from || "")
    .replace(/^whatsapp:/, "")
    .replace(/\D+/g, "");
}

/* =====================================================
   MENUS
===================================================== */

const MAIN_MENU = `
👋 *Welcome to ZimEduFinder*

What are you looking for today?

1️⃣ Find Schools  
2️⃣ Find Private Tutors  
3️⃣ Help
`;

const SCHOOL_MENU = `
🏫 *Find Schools*

Choose an option:

1️⃣ Cambridge schools (top rated)
2️⃣ Boarding schools
3️⃣ Schools with swimming pools
4️⃣ Primary schools (advanced)
5️⃣ Custom search
6️⃣ Back
`;

const TUTOR_MENU = `
👨‍🏫 *Private Tutors*

1️⃣ Find a tutor
2️⃣ Register as a tutor
3️⃣ Back
`;

const TUTOR_REGISTER_INTRO = `
📝 *Tutor Registration*

We’ll ask you a few quick questions.

Reply *OK* to continue  
or *BACK* to cancel
`;

const HELP_TEXT = `
ℹ️ *ZimEduFinder Help*

• Use numbers to choose options  
• No typing needed  
• Send *menu* anytime  

Example:
👉 Reply *1* to find schools
`;

/* =====================================================
   RICH COMMAND MAP (SCHOOLS)
===================================================== */

const SCHOOL_COMMANDS = {
  "1": "find harare cambridge advanced mixed science computer",
  "2": "find harare boarding cambridge enhanced",
  "3": "find harare swimming football rugby",
  "4": "find harare primary advanced",
};

/* =====================================================
   WEBHOOK
===================================================== */

router.post("/webhook", async (req, res) => {
  try {
    const from = req.body.From;
    const body = (req.body.Body || "").trim();
    const text = body.toLowerCase();

    if (!from) return sendTwiml(res, "Missing sender");

    const phone = normalizePhone(from);

    /* ---------- Load or create user ---------- */

    let user = await User.findOne({ provider: "whatsapp", providerId: phone });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId: phone,
        role: "user",
        lastState: "MAIN_MENU",
      });
    }

    console.log("📩 IN:", { phone, text, state: user.lastState });

    /* =====================================================
       GLOBAL COMMANDS
    ===================================================== */

    if (!text || ["hi", "hello", "menu", "start"].includes(text)) {
      user.lastState = "MAIN_MENU";
      await user.save();
      return sendTwiml(res, MAIN_MENU);
    }

    if (text === "help") {
      return sendTwiml(res, HELP_TEXT);
    }

    /* =====================================================
       MAIN MENU
    ===================================================== */

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

      if (text === "3") {
        return sendTwiml(res, HELP_TEXT);
      }

      return sendTwiml(res, MAIN_MENU);
    }

    /* =====================================================
       SCHOOL MENU
    ===================================================== */

    if (user.lastState === "SCHOOL_MENU") {
      if (text === "6") {
        user.lastState = "MAIN_MENU";
        await user.save();
        return sendTwiml(res, MAIN_MENU);
      }

      if (text === "5") {
        user.lastState = "CUSTOM_SCHOOL_SEARCH";
        await user.save();
        return sendTwiml(
          res,
          "✏️ Type your search like:\nfind harare cambridge boarding swimming"
        );
      }

      if (SCHOOL_COMMANDS[text]) {
        const command = SCHOOL_COMMANDS[text];
        user.lastState = "MAIN_MENU";
        await user.save();
        return handleFindCommand(res, user, command);
      }

      return sendTwiml(res, SCHOOL_MENU);
    }

    /* =====================================================
       CUSTOM SCHOOL SEARCH
    ===================================================== */

    if (user.lastState === "CUSTOM_SCHOOL_SEARCH") {
      if (!text.startsWith("find")) {
        return sendTwiml(
          res,
          "Please start with *find*.\nExample:\nfind harare cambridge"
        );
      }

      user.lastState = "MAIN_MENU";
      await user.save();
      return handleFindCommand(res, user, body);
    }

    /* =====================================================
       TUTOR MENU
    ===================================================== */

    if (user.lastState === "TUTOR_MENU") {
      if (text === "3") {
        user.lastState = "MAIN_MENU";
        await user.save();
        return sendTwiml(res, MAIN_MENU);
      }

      if (text === "1") {
        return sendTwiml(
          res,
          "🔍 Tutor search coming soon.\nSend *menu* to continue."
        );
      }

      if (text === "2") {
        user.lastState = "TUTOR_REGISTER";
        await user.save();
        return sendTwiml(res, TUTOR_REGISTER_INTRO);
      }

      return sendTwiml(res, TUTOR_MENU);
    }

    /* =====================================================
       TUTOR REGISTRATION (SMART FORM ENTRY)
    ===================================================== */

    if (user.lastState === "TUTOR_REGISTER") {
      if (text === "back") {
        user.lastState = "TUTOR_MENU";
        await user.save();
        return sendTwiml(res, TUTOR_MENU);
      }

      if (text === "ok") {
        user.lastState = "TUTOR_REGISTER_NAME";
        await user.save();
        return sendTwiml(res, "👤 What is your full name?");
      }

      return sendTwiml(res, TUTOR_REGISTER_INTRO);
    }

    if (user.lastState === "TUTOR_REGISTER_NAME") {
      user.tutorProfile = { name: body };
      user.lastState = "TUTOR_REGISTER_SUBJECTS";
      await user.save();
      return sendTwiml(
        res,
        "📘 What subjects do you teach?\nExample: Maths, Physics"
      );
    }

    if (user.lastState === "TUTOR_REGISTER_SUBJECTS") {
      user.tutorProfile.subjects = body;
      user.lastState = "TUTOR_REGISTER_CITY";
      await user.save();
      return sendTwiml(res, "📍 Which city are you based in?");
    }

    if (user.lastState === "TUTOR_REGISTER_CITY") {
      user.tutorProfile.city = body;
      user.lastState = "TUTOR_REGISTER_DONE";
      await user.save();
      return sendTwiml(
        res,
        "✅ Registration complete!\nWe will review and list your profile."
      );
    }

    /* =====================================================
       FALLBACK
    ===================================================== */

    return sendTwiml(res, MAIN_MENU);
  } catch (err) {
    console.error("❌ TWILIO ERROR:", err);
    return sendTwiml(res, "Something went wrong. Send *menu* to restart.");
  }
});

/* =====================================================
   FIND HANDLER
===================================================== */

async function handleFindCommand(res, user, command) {
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");

  if (!site) {
    return sendTwiml(res, "Search unavailable. Try again later.");
  }

  let recs = [];

  try {
    const resp = await axios.post(`${site}/api/recommend`, {
      query: command,
    });
    recs = resp.data?.recommendations || [];
  } catch (e) {
    return sendTwiml(res, "Search failed. Please try again.");
  }

  if (!recs.length) {
    return sendTwiml(res, "No schools found. Try another option.");
  }

  const lines = ["🎯 *Top school matches:*"];

  for (const r of recs.slice(0, 5)) {
    lines.push(`\n• *${r.name}*`);
    if (r.city) lines.push(`  📍 ${r.city}`);
    if (r.website) lines.push(`  🌐 ${r.website}`);
  }

  return sendTwiml(res, lines.join("\n"));
}

export default router;
