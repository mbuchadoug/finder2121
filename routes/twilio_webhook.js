import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------------------------------------------------
   Helpers
--------------------------------------------------- */

function sendText(res, text) {
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

/* ---------------------------------------------------
   Parse filters from words
--------------------------------------------------- */
function parseFilters(words) {
  const f = {
    curriculum: [],
    type2: [],
    schoolPhase: [],
    learningEnvironment: "",
    gender: "",
    facilities: [],
  };

  const add = (a, v) => !a.includes(v) && a.push(v);

  for (const w of words.map(w => w.toLowerCase())) {
    if (w === "cambridge") add(f.curriculum, "Cambridge");
    if (w === "zimsec") add(f.curriculum, "Zimsec");
    if (w === "ib") add(f.curriculum, "IB");

    if (w === "boarding") add(f.type2, "Boarding");
    if (w === "day") add(f.type2, "Day");

    if (w === "primary") add(f.schoolPhase, "Primary School");
    if (w === "high") add(f.schoolPhase, "High School");
    if (w === "pre") add(f.schoolPhase, "Pre-School");

    if (w === "advanced") f.learningEnvironment = "Advanced";
    if (w === "enhanced") f.learningEnvironment = "Enhanced";
    if (w === "comprehensive") f.learningEnvironment = "Comprehensive";

    if (w === "swimming") add(f.facilities, "swimmingPool");
    if (w === "library") add(f.facilities, "library");
    if (w === "computer") add(f.facilities, "computerLab");
    if (w === "science") add(f.facilities, "scienceLabs");
  }

  return f;
}

/* ---------------------------------------------------
   MAIN WEBHOOK
--------------------------------------------------- */

router.post("/webhook", async (req, res) => {
  try {
    const from = String(req.body.From || "");
    const body = String(req.body.Body || "").trim();
    const text = body.toLowerCase();
    const providerId = from.replace(/^whatsapp:/, "");
    const phone = normalizePhone(providerId);

    if (!providerId) return sendText(res, "Missing sender");

    /* ---------- Load or create user ---------- */
    let user = await User.findOne({ provider: "whatsapp", providerId });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        phone,
        lastAction: null,
      });
    }

    /* ---------------------------------------------------
       MAIN MENU
    --------------------------------------------------- */
    if (
      !text ||
      ["hi", "hello", "menu", "start"].includes(text)
    ) {
      user.lastAction = "main_menu";
      await user.save();

      return sendText(
        res,
        [
          "👋 *Welcome to ZimEduFinder*",
          "",
          "What are you looking for today?",
          "",
          "1️⃣ Find Schools",
          "2️⃣ Find Private Tutors",
          "3️⃣ Help",
        ].join("\n")
      );
    }

    /* ---------------------------------------------------
       MAIN MENU SELECTION
    --------------------------------------------------- */
    if (user.lastAction === "main_menu") {
      if (text === "1") {
        user.lastAction = "schools_menu";
        await user.save();

        return sendText(
          res,
          [
            "🏫 *Find Schools*",
            "",
            "Choose an option:",
            "",
            "1️⃣ Harare · Cambridge · Advanced",
            "2️⃣ Harare · Cambridge · Boarding · Primary",
            "3️⃣ Harare · Boarding · Any curriculum",
            "4️⃣ Harare · Swimming pool · Family schools",
          ].join("\n")
        );
      }

      if (text === "2") {
        user.lastAction = "tutor_intro";
        await user.save();

        return sendText(
          res,
          [
            "👩‍🏫 *Private Tutors*",
            "",
            "1️⃣ Find a tutor",
            "2️⃣ Register as a tutor",
          ].join("\n")
        );
      }

      if (text === "3") {
        user.lastAction = null;
        await user.save();
        return sendText(res, "Type *find harare cambridge* or choose a number.");
      }
    }

    /* ---------------------------------------------------
       SCHOOL MENU SELECTION (FIXED LOOP)
    --------------------------------------------------- */
    let command = text;

    if (user.lastAction === "schools_menu") {
      user.lastAction = null;
      await user.save();

      if (text === "1") command = "find harare cambridge advanced";
      else if (text === "2") command = "find harare cambridge boarding primary";
      else if (text === "3") command = "find harare boarding";
      else if (text === "4") command = "find harare swimming";
    }

    /* ---------------------------------------------------
       FIND COMMAND
    --------------------------------------------------- */
    const words = command.split(/\s+/);
    if (words[0] === "find") {
      const city = words[1] || "harare";
      const filters = parseFilters(words.slice(2));

      const site = process.env.SITE_URL?.replace(/\/$/, "");
      if (!site) return sendText(res, "Service unavailable");

      let recs = [];
      try {
        const resp = await axios.post(`${site}/api/recommend`, {
          city: city.charAt(0).toUpperCase() + city.slice(1),
          ...filters,
        });
        recs = resp.data?.recommendations || [];
      } catch {
        return sendText(res, "Search failed. Try again.");
      }

      if (!recs.length) {
        return sendText(res, "No schools found.");
      }

      const twiml = new MessagingResponse();

      let attachPinned = false;

      for (const r of recs.slice(0, 5)) {
        if (/st[\s-]*eurit/.test(r.name.toLowerCase())) attachPinned = true;
      }

      /* ---------- PINNED SCHOOL MEDIA (UNCHANGED FROM OLD CODE) ---------- */
      if (attachPinned) {
        const msg1 = twiml.message(
          "⭐ *Pinned School: St Eurit International School*\n📍 Harare\n📘 Cambridge\n👉 Register: https://skoolfinder.net/register/st-eurit-international-school"
        );
        msg1.media(`${site}/docs/st-eurit.jpg`);

        const msg2 = twiml.message("St Eurit – School Profile (PDF)");
        msg2.media(`${site}/docs/st-eurit-profile.pdf`);

        const msg3 = twiml.message("St Eurit – Registration Form (PDF)");
        msg3.media(`${site}/docs/st-eurit-registration.pdf`);
      }

      /* ---------- TEXT LIST ---------- */
      const lines = ["🎓 *Top Matches:*"];
      for (const r of recs.slice(0, 5)) {
        lines.push(`• ${r.name}`);
        if (r.website) lines.push(`  🌐 ${r.website}`);
      }

      twiml.message(lines.join("\n"));
      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    /* ---------------------------------------------------
       FALLBACK
    --------------------------------------------------- */
    return sendText(res, "Type *hi* to start.");

  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendText(res, "Something went wrong.");
  }
});

export default router;
