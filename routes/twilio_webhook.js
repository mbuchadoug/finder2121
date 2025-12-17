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

function send(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(v) {
  return String(v || "").replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

function nav() {
  return `

1️⃣ Back
2️⃣ Main menu`;
}

/* ================= SCHOOL FILTER PARSER (UNCHANGED) ================= */

function parseSchoolFilters(words) {
  const f = {
    curriculum: [],
    type2: [],
    schoolPhase: [],
    facilities: [],
    learningEnvironment: "",
    gender: "",
  };

  const add = (arr, v) => !arr.includes(v) && arr.push(v);

  for (const w0 of words) {
    const w = w0.toLowerCase();

    if (w === "cambridge") add(f.curriculum, "Cambridge");
    if (w === "zimsec") add(f.curriculum, "Zimsec");

    if (w === "boarding") add(f.type2, "Boarding");
    if (w === "day") add(f.type2, "Day");

    if (w === "primary") add(f.schoolPhase, "Primary School");
    if (w === "high") add(f.schoolPhase, "High School");

    if (w === "swimming") add(f.facilities, "swimmingPool");
    if (w === "computer") add(f.facilities, "computerLab");
    if (w === "science") add(f.facilities, "scienceLabs");

    if (w === "advanced") f.learningEnvironment = "Advanced";
    if (w === "boys") f.gender = "Boys";
    if (w === "girls") f.gender = "Girls";
  }

  return f;
}

/* ================= SUBJECT CATEGORIES ================= */

const SUBJECTS = {
  "1": ["Mathematics"],
  "2": ["Physics", "Chemistry", "Biology"],
  "3": ["Accounting", "Economics", "Business Studies"],
  "4": ["English"],
  "5": ["ICT", "Computer Science"],
};

/* ================= MAIN WEBHOOK ================= */

router.post("/webhook", async (req, res) => {
  try {
    const body = String(req.body.Body || "").trim();
    const lc = body.toLowerCase();
    const phone = normalizePhone(req.body.From);

    let user = await User.findOne({ provider: "whatsapp", providerId: phone });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId: phone,
        chatState: "HOME",
        tutorDraft: {},
      });
    }

    /* ========== GLOBAL MENU ========== */
    if (["hi", "menu", "start", "home", "2"].includes(lc)) {
      user.chatState = "HOME";
      user.tutorDraft = {};
      user.markModified("tutorDraft");
      await user.save();

      return send(
        res,
        `👋 *Welcome to ZimEduFinder*

1️⃣ Find Schools
2️⃣ Find Private Tutors
3️⃣ I am a Tutor (Register)
4️⃣ Tutor: Add / Update Bio`
      );
    }

    /* ========== HOME ========== */
    if (user.chatState === "HOME") {
      if (lc === "1") {
        user.chatState = "SCHOOL_SEARCH";
        await user.save();

        return send(
          res,
          `🏫 *Find Schools*
Examples:
• find harare cambridge
• find harare primary swimming`
        );
      }

      if (lc === "2") {
        user.chatState = "TUTOR_SEARCH";
        await user.save();

        return send(
          res,
          `👩‍🏫 *Find a Tutor*
1️⃣ Mathematics
2️⃣ Sciences
3️⃣ Commercial Subjects
4️⃣ Languages
5️⃣ ICT`
        );
      }

      if (lc === "3") {
        user.chatState = "TUTOR_NAME";
        user.tutorDraft = { phone };
        user.markModified("tutorDraft");
        await user.save();
        return send(res, "📝 Tutor Registration\n\nWhat is your *full name*?");
      }

      if (lc === "4") {
        const tutor = await Tutor.findOne({ phone, verified: true });
        if (!tutor) {
          return send(res, "❌ Only verified tutors can add a bio.");
        }
        user.chatState = "TUTOR_BIO";
        await user.save();
        return send(res, "✍️ Write your tutor bio:");
      }

      return send(res, "Reply with a valid option.");
    }

    /* ========== SCHOOL SEARCH (FULLY RESTORED) ========== */
    if (user.chatState === "SCHOOL_SEARCH") {
      if (lc === "1") {
        user.chatState = "HOME";
        await user.save();
        return send(res, "Back to menu.");
      }

      const parts = lc.split(/\s+/);
      if (parts[0] !== "find") {
        return send(res, "Use: find harare cambridge primary" + nav());
      }

      const city = parts[1] || "harare";
      const filters = parseSchoolFilters(parts.slice(2));
      const site = process.env.SITE_URL.replace(/\/$/, "");

      const resp = await axios.post(`${site}/api/recommend`, {
        city: city.charAt(0).toUpperCase() + city.slice(1),
        ...filters,
      });

      const schools = resp.data?.recommendations || [];

      user.chatState = "HOME";
      await user.save();

      if (!schools.length) {
        return send(res, "No schools found." + nav());
      }

      return send(
        res,
        schools
          .slice(0, 5)
          .map(s => `🏫 ${s.name}\n${s.website || ""}`)
          .join("\n\n") + nav()
      );
    }

    /* ========== TUTOR SEARCH ========== */
    if (user.chatState === "TUTOR_SEARCH") {
      if (!SUBJECTS[lc]) return send(res, "Choose 1–5.");

      const tutors = await Tutor.find({
        subjects: { $in: SUBJECTS[lc] },
        verified: true,
      }).limit(5);

      user.chatState = "HOME";
      await user.save();

      if (!tutors.length) {
        return send(res, "No tutors available yet." + nav());
      }

      return send(
        res,
        tutors
          .map(
            t =>
              `👤 ${t.name}
📚 ${t.subjects.join(", ")}
🎓 ${t.levels.join(", ")}
📍 ${t.city}
📝 ${t.bio || "No bio yet"}
📞 ${t.phone}`
          )
          .join("\n\n") + nav()
      );
    }

    /* ========== TUTOR BIO SAVE ========== */
    if (user.chatState === "TUTOR_BIO") {
      await Tutor.findOneAndUpdate({ phone }, { bio: body });
      user.chatState = "HOME";
      await user.save();
      return send(res, "✅ Bio saved successfully.");
    }

    /* ========== REGISTRATION FLOW (UNCHANGED) ========== */

    const d = user.tutorDraft || {};

    if (user.chatState === "TUTOR_NAME") {
      d.name = body;
      user.tutorDraft = d;
      user.chatState = "TUTOR_SUBJECTS";
      user.markModified("tutorDraft");
      await user.save();

      return send(
        res,
        `📚 Subjects:
1️⃣ Mathematics
2️⃣ Sciences
3️⃣ Commercial Subjects
4️⃣ Languages
5️⃣ ICT`
      );
    }

    if (user.chatState === "TUTOR_SUBJECTS") {
      if (!SUBJECTS[lc]) return send(res, "Choose 1–5.");
      d.subjects = SUBJECTS[lc];
      user.tutorDraft = d;
      user.chatState = "TUTOR_LEVELS";
      user.markModified("tutorDraft");
      await user.save();

      return send(
        res,
        `🎓 Levels:
1️⃣ Primary
2️⃣ High School
3️⃣ Both`
      );
    }

    if (user.chatState === "TUTOR_LEVELS") {
      d.levels =
        lc === "1" ? ["Primary"]
        : lc === "2" ? ["High School"]
        : ["Primary", "High School"];

      user.tutorDraft = d;
      user.chatState = "TUTOR_MODE";
      user.markModified("tutorDraft");
      await user.save();

      return send(
        res,
        `🏠 Teaching mode:
1️⃣ In-person
2️⃣ Online
3️⃣ Both`
      );
    }

    if (user.chatState === "TUTOR_MODE") {
      d.mode = lc === "1" ? "in-person" : lc === "2" ? "online" : "both";
      user.tutorDraft = d;
      user.chatState = "TUTOR_CITY";
      user.markModified("tutorDraft");
      await user.save();

      return send(res, "📍 Which city are you based in?");
    }

    if (user.chatState === "TUTOR_CITY") {
      d.city = body;

      await Tutor.create({
        name: d.name,
        phone: d.phone,
        subjects: d.subjects,
        levels: d.levels,
        mode: d.mode,
        city: d.city,
        verified: false,
      });

      user.chatState = "HOME";
      user.tutorDraft = {};
      user.markModified("tutorDraft");
      await user.save();

      return send(res, "✅ Registration complete. Pending verification.");
    }

    return send(res, "Type *menu* to continue.");

  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return send(res, "Something went wrong. Type *menu*.");
  }
});

export default router;
