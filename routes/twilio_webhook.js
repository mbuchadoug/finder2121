import express from "express";
import { Router } from "express";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import axios from "axios";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------------- Helpers ---------------- */

function sendText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.type("text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(p) {
  return String(p || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\D+/g, "");
}

/* ---------------- Webhook ---------------- */

router.post("/webhook", async (req, res) => {
  try {
    const bodyRaw = String(req.body.Body || "").trim();
    const text = bodyRaw.toLowerCase();
    const from = String(req.body.From || "");
    const profileName = String(req.body.ProfileName || "");

    if (!from) return sendText(res, "Missing sender info.");

    const providerId = from.replace(/^whatsapp:/i, "");
    const phone = normalizePhone(providerId);

    /* ---- Load / create user ---- */
    let user = await User.findOne({ provider: "whatsapp", providerId });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        phone,
        name: profileName || undefined,
        role: "user",
      });
    }

    /* ---- IMPORTANT: use SITE_URL ---- */
    const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");
    if (!SITE) {
      console.error("❌ SITE_URL missing");
      return sendText(res, "Service unavailable. Try again later.");
    }

    /* ---------------- Main Menu ---------------- */

    const mainMenu = `👋 Welcome to *ZimEduFinder*

What are you looking for today?

1️⃣ Find Schools  
2️⃣ Find Private Tutors  
3️⃣ Help`;

    if (!text || ["hi", "hello", "menu", "start"].includes(text)) {
      return sendText(res, mainMenu);
    }

    /* ---------------- Help ---------------- */

    if (text === "3" || text === "help") {
      return sendText(
`ℹ️ *How to use ZimEduFinder*

Reply with a number:

1️⃣ Find schools  
2️⃣ Find private tutors  
3️⃣ Help

Or type:
find harare cambridge boarding primary`
      );
    }

    /* ---------------- Find Schools Menu ---------------- */

    if (text === "1") {
      return sendText(
`🏫 *Find Schools*

Choose an option:

1️⃣ Harare · Cambridge · Advanced  
2️⃣ Harare · Cambridge · Boarding · Primary  
3️⃣ Harare · Boarding · Any curriculum  
4️⃣ Harare · Swimming pool · Family schools

Or type:
find harare cambridge advanced`
      );
    }

    /* ---------------- Quick Presets ---------------- */

    let command = null;

    if (text === "1") command = "find harare cambridge advanced";
    if (text === "2") command = "find harare cambridge boarding primary";
    if (text === "3") command = "find harare boarding";
    if (text === "4") command = "find harare swimming";

    if (command) {
      // fall through to search handler
    } else if (text.startsWith("find ")) {
      command = text;
    } else if (text === "2") {
      return sendText(
`👩‍🏫 *Private Tutors*

Tutor search & registration is coming next.

Type *hi* to go back to menu.`
      );
    } else {
      return sendText(res, mainMenu);
    }

    /* ---------------- Search Schools ---------------- */

    const twiml = new MessagingResponse();

    let recs = [];
    try {
      const resp = await axios.post(`${SITE}/api/recommend`, {
        city: "Harare",
      });
      recs = resp.data?.recommendations || [];
    } catch (e) {
      console.error("API error:", e.message);
    }

    /* ---- PINNED: ST EURIT (MEDIA FIRST) ---- */

    const m1 = twiml.message(
`⭐ *Pinned School*
*St Eurit International School*
📍 Harare
📘 Cambridge

👉 Apply:
https://skoolfinder.net/register/st-eurit-international-school`
    );
    m1.media(`${SITE}/docs/st-eurit.jpg`);

    const m2 = twiml.message("📄 School Profile");
    m2.media(`${SITE}/docs/st-eurit-profile.pdf`);

    const m3 = twiml.message("📄 Registration Form");
    m3.media(`${SITE}/docs/st-eurit-registration.pdf`);

    /* ---- Text results ---- */

    if (recs.length) {
      twiml.message(
        `Other schools:\n` +
          recs
            .slice(0, 5)
            .map((r) => `• ${r.name}`)
            .join("\n")
      );
    } else {
      twiml.message("No other schools found for those filters.");
    }

    res.type("text/xml");
    return res.send(twiml.toString());
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendText(res, "Something went wrong. Type *hi* to start again.");
  }
});

export default router;
