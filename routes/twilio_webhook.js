import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";
import Tutor from "../models/tutor.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ------------------------------------------------ */
/* Helpers                                          */
/* ------------------------------------------------ */

function sendTwiml(res, messages = []) {
  const twiml = new MessagingResponse();
  messages.forEach((m) => {
    if (typeof m === "string") twiml.message(m);
    else if (m.body && m.media) {
      const msg = twiml.message(m.body);
      msg.media(m.media);
    }
  });
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(p) {
  return String(p || "").replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

/* ------------------------------------------------ */
/* SCHOOL FILTER PARSER (UNCHANGED, WORKING)        */
/* ------------------------------------------------ */

function parseFiltersFromWords(words) {
  const f = {
    curriculum: [],
    type2: [],
    schoolPhase: [],
    learningEnvironment: "",
    gender: "",
    facilities: [],
  };

  const add = (a, v) => v && !a.includes(v) && a.push(v);

  for (const w of words.map((x) => x.toLowerCase())) {
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

    if (w === "boys") f.gender = "Boys";
    if (w === "girls") f.gender = "Girls";
    if (w === "mixed") f.gender = "Mixed";

    if (w === "science") add(f.facilities, "scienceLabs");
    if (w === "computer") add(f.facilities, "computerLab");
    if (w === "library") add(f.facilities, "library");
    if (w === "steam") add(f.facilities, "makerSpaceSteamLab");
    if (w === "swimming") add(f.facilities, "swimmingPool");
    if (w === "rugby") add(f.facilities, "rugbyField");
    if (w === "football") add(f.facilities, "footballPitch");
    if (w === "sen") add(f.facilities, "learningSupportSEN");
    if (w === "aftercare") add(f.facilities, "aftercare");
  }

  return f;
}

/* ------------------------------------------------ */
/* MAIN WEBHOOK                                     */
/* ------------------------------------------------ */

router.post("/webhook", async (req, res) => {
  try {
    const { From, Body, ProfileName } = req.body;
    if (!From) return sendTwiml(res, ["Missing sender"]);

    const providerId = From.replace(/^whatsapp:/i, "");
    const phone = normalizePhone(providerId);
    const text = String(Body || "").trim();
    const lc = text.toLowerCase();

    let user = await User.findOne({ provider: "whatsapp", providerId });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        phone,
        name: ProfileName,
      });
    }

    /* -------------------------------------------- */
    /* RESET / HOME                                 */
    /* -------------------------------------------- */

    if (!lc || ["hi", "menu", "home"].includes(lc)) {
      user.chatState = "HOME";
      user.tutorDraft = null;
      await user.save();

      return sendTwiml(res, [
        "👋 *Welcome to ZimEduFinder*",
        "",
        "What would you like to do?",
        "",
        "1️⃣ Find Schools",
        "2️⃣ Find Private Tutors",
        "3️⃣ I am a Tutor (Register)",
      ]);
    }

    /* -------------------------------------------- */
    /* HOME MENU                                    */
    /* -------------------------------------------- */

    if (user.chatState === "HOME") {
      if (lc === "1") {
        user.chatState = "SCHOOLS";
        await user.save();
        return sendTwiml(res, [
          "🏫 *Find Schools*",
          "",
          "Reply with a number:",
          "",
          "1️⃣ Cambridge · Advanced · Science & ICT",
          "2️⃣ Cambridge · Boarding · Primary · Swimming",
          "3️⃣ Boarding · Sports focused",
          "4️⃣ Family schools · Aftercare",
        ]);
      }

      if (lc === "2") {
        user.chatState = "TUTOR_SEARCH";
        await user.save();
        return sendTwiml(res, [
          "👩‍🏫 *Find a Private Tutor*",
          "",
          "Choose an option:",
          "",
          "1️⃣ Primary level tutors",
          "2️⃣ Cambridge tutors",
          "3️⃣ Online tutors",
          "4️⃣ Harare in-person tutors",
        ]);
      }

      if (lc === "3") {
        user.chatState = "TUTOR_REG_NAME";
        user.tutorDraft = {};
        await user.save();
        return sendTwiml(res, [
          "📝 *Tutor Registration*",
          "",
          "What is your *full name*?",
        ]);
      }
    }

    /* -------------------------------------------- */
    /* SCHOOL QUICK SEARCH (UNCHANGED LOGIC)        */
    /* -------------------------------------------- */

    if (user.chatState === "SCHOOLS") {
      const map = {
        "1": "find harare cambridge advanced science computer",
        "2": "find harare cambridge boarding primary swimming",
        "3": "find harare boarding rugby football",
        "4": "find harare mixed aftercare",
      };

      const command = map[lc];
      if (!command) return sendTwiml(res, ["Reply with 1–4 or type *menu*"]);

      const words = command.split(" ");
      const parsed = parseFiltersFromWords(words.slice(2));

      const payload = {
        city: "Harare",
        ...parsed,
      };

      const site = process.env.SITE_URL.replace(/\/$/, "");
      const r = await axios.post(`${site}/api/recommend`, payload);
      const recs = r.data?.recommendations || [];

      const tw = new MessagingResponse();
      let pinned = false;

      recs.slice(0, 5).forEach((s) => {
        tw.message(`🏫 ${s.name}\n🌐 ${s.website || ""}`);
        if (/st[\s-]*eurit/.test(s.name.toLowerCase())) pinned = true;
      });

      if (pinned) {
        const base = site;
        const msg = tw.message(
          "⭐ *Pinned: St Eurit International School*\n👉 Register:\nhttps://skoolfinder.net/register/st-eurit-international-school"
        );
        msg.media(`${base}/docs/st-eurit.jpg`);
      }

      res.set("Content-Type", "text/xml");
      return res.send(tw.toString());
    }

    /* -------------------------------------------- */
    /* TUTOR SEARCH                                 */
    /* -------------------------------------------- */

    if (user.chatState === "TUTOR_SEARCH") {
      const query = {
        "1": { levels: "Primary" },
        "2": { subjects: /cambridge/i },
        "3": { mode: "online" },
        "4": { city: "Harare" },
      }[lc];

      if (!query) return sendTwiml(res, ["Reply 1–4 or type *menu*"]);

      const tutors = await Tutor.find(query).limit(5);

      if (!tutors.length)
        return sendTwiml(res, ["No tutors found. Try another option."]);

      return sendTwiml(
        res,
        tutors.map(
          (t) =>
            `👩‍🏫 *${t.name}*\n📚 ${t.subjects.join(
              ", "
            )}\n📍 ${t.city}\n📞 ${t.phone}`
        )
      );
    }

    /* -------------------------------------------- */
    /* TUTOR REGISTRATION (SMART FORM)              */
    /* -------------------------------------------- */

    if (user.chatState?.startsWith("TUTOR_REG")) {
      const d = user.tutorDraft || {};

      if (user.chatState === "TUTOR_REG_NAME") {
        d.name = text;
        user.chatState = "TUTOR_REG_SUBJECTS";
        user.tutorDraft = d;
        await user.save();
        return sendTwiml(res, ["What subjects do you teach? (comma separated)"]);
      }

      if (user.chatState === "TUTOR_REG_SUBJECTS") {
        d.subjects = text.split(",").map((s) => s.trim());
        user.chatState = "TUTOR_REG_LEVELS";
        user.tutorDraft = d;
        await user.save();
        return sendTwiml(res, [
          "Which levels?",
          "e.g. Primary, Cambridge, ZIMSEC",
        ]);
      }

      if (user.chatState === "TUTOR_REG_LEVELS") {
        d.levels = text.split(",").map((s) => s.trim());
        user.chatState = "TUTOR_REG_MODE";
        user.tutorDraft = d;
        await user.save();
        return sendTwiml(res, [
          "Teaching mode?",
          "1️⃣ In-person",
          "2️⃣ Online",
          "3️⃣ Both",
        ]);
      }

      if (user.chatState === "TUTOR_REG_MODE") {
        d.mode = lc === "1" ? "in-person" : lc === "2" ? "online" : "both";
        user.chatState = "TUTOR_REG_CITY";
        user.tutorDraft = d;
        await user.save();
        return sendTwiml(res, ["Which city are you based in?"]);
      }

      if (user.chatState === "TUTOR_REG_CITY") {
        d.city = text;
        d.phone = phone;

        await Tutor.create(d);

        user.chatState = "HOME";
        user.tutorDraft = null;
        await user.save();

        return sendTwiml(res, [
          "✅ *Registration complete!*",
          "Our team will review and verify your profile.",
          "",
          "Type *menu* to continue.",
        ]);
      }
    }

    return sendTwiml(res, ["Type *menu* to continue."]);
  } catch (e) {
    console.error("TWILIO ERROR:", e);
    return sendTwiml(res, ["Something went wrong. Type *menu*"]);
  }
});

export default router;
