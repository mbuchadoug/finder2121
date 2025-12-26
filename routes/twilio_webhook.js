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
  return String(v || "")
    .replace(/^whatsapp:/i, "")
    .replace(/\D+/g, "");
}

/* ================= SCHOOL FILTER PARSER ================= */

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
    if (w === "ib") add(f.curriculum, "IB");

    if (w === "boarding") add(f.type2, "Boarding");
    if (w === "day") add(f.type2, "Day");

    if (w === "primary") add(f.schoolPhase, "Primary School");
    if (w === "high") add(f.schoolPhase, "High School");

    if (w === "science") add(f.facilities, "scienceLabs");
    if (w === "computer") add(f.facilities, "computerLab");
    if (w === "library") add(f.facilities, "library");
    if (w === "steam") add(f.facilities, "makerSpaceSteamLab");
    if (w === "swimming") add(f.facilities, "swimmingPool");
    if (w === "rugby") add(f.facilities, "rugbyField");
    if (w === "hockey") add(f.facilities, "hockeyField");
    if (w === "football") add(f.facilities, "footballPitch");
    if (w === "tennis") add(f.facilities, "tennisCourts");
    if (w === "basketball") add(f.facilities, "basketballCourt");
    if (w === "sen") add(f.facilities, "learningSupportSEN");
    if (w === "clinic") add(f.facilities, "schoolClinicNurse");
    if (w === "aftercare") add(f.facilities, "aftercare");
    if (w === "transport") add(f.facilities, "transportBuses");

    if (w === "advanced") f.learningEnvironment = "Advanced";
    if (w === "enhanced") f.learningEnvironment = "Enhanced";
    if (w === "comprehensive") f.learningEnvironment = "Comprehensive";

    if (w === "boys") f.gender = "Boys";
    if (w === "girls") f.gender = "Girls";
    if (w === "mixed") f.gender = "Mixed";
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

    /* ========== GLOBAL RESET ========== */
    if (["hi", "menu", "start", "home"].includes(lc)) {
      user.chatState = "HOME";
      user.tutorDraft = {};
      user.markModified("tutorDraft");
      await user.save();

      return send(
        res,
`👋 *Welcome to ZimEduFinder*
     Reply with a number:

1️⃣ Find Schools
2️⃣ Find Private Tutors
3️⃣ I am a Tutor (Register)
4️⃣ Tutor: Add / Update Bio`
      );
    }

    /* ========== HOME MENU ========== */
    if (user.chatState === "HOME") {

      if (lc === "1") {
        user.chatState = "SCHOOL_SEARCH";
        await user.save();

        return send(
          res,
`🏫 *Find Schools*
Reply with a number:

1️⃣ Cambridge · Advanced · Science & ICT
2️⃣ Boarding · Primary · Swimming
3️⃣ Sports Focused · Boarding
4️⃣ Comprehensive · Family Schools
5️⃣ Girls · Cambridge · Advanced
6️⃣ Boys · Boarding · Rugby
7️⃣ SEN Support · Primary · Day
8️⃣ IB · Enhanced · High School
9️⃣ Day · Comprehensive
🔟 STEM / Robotics · Primary

0️⃣ Back to menu`
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
5️⃣ ICT

0️⃣ Back to menu`
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
          return send(res, "❌ Only verified tutors can update bio.");
        }

        user.chatState = "TUTOR_BIO";
        await user.save();

        return send(res, "✍️ Please send your tutor bio.");
      }

      return send(res, "Reply with 1, 2, 3 or 4.");
    }

    /* ========== SCHOOL SEARCH (PATCHED ONLY) ========== */
    if (user.chatState === "SCHOOL_SEARCH") {

      if (lc === "0") {
        user.chatState = "HOME";
        await user.save();
        return send(res, "Back to menu.\n\nType *hi*");
      }

      const MAP = {
        "1": "find harare cambridge advanced science computer library",
        "2": "find harare boarding primary swimming cafeteria",
        "3": "find harare boarding rugby hockey football athletics",
        "4": "find harare comprehensive mixed aftercare transport",
        "5": "find harare girls cambridge advanced science library",
        "6": "find harare boys boarding rugby football cricket",
        "7": "find harare primary day sen counseling clinic",
        "8": "find harare high ib enhanced science library",
        "9": "find harare day comprehensive transport cafeteria",
        "10": "find harare primary cambridge advanced steam computer science",
      };

      const command = MAP[lc];
      if (!command) return send(res, "Choose 1–10 or 0.");

      const parts = command.split(/\s+/);
      const city = parts[1];
      const filters = parseSchoolFilters(parts.slice(2));
      const site = process.env.SITE_URL.replace(/\/$/, "");

      const resp = await axios.post(`${site}/api/recommend`, {
        city: city.charAt(0).toUpperCase() + city.slice(1),
        ...filters,
      });

      const schools = resp.data?.recommendations || [];
      const twiml = new MessagingResponse();
      let pinned = false;


      /*
  if (pinned) {
  // Message 1: image
  const imgMsg = twiml.message(
`⭐ *Pinned School: St Eurit International School*
👉 https://skoolfinder.net/register/st-eurit-international-school`
  );
  imgMsg.media(`${site}/docs/st-eurit.jpg`);

  // Message 2: registration PDF
  const pdf1 = twiml.message("📄 Registration Form");
  pdf1.media(`${site}/docs/st-eurit-registration.pdf`);

  // Message 3: enrollment PDF
  const pdf2 = twiml.message("📄 Enrollment Requirements");
  pdf2.media(`${site}/docs/st-eurit-enrollment-requirements.pdf`);
}*/
      for (const s of schools.slice(0, 5)) {
        twiml.message(`🏫 ${s.name}\n${s.website || ""}`);
        if (/st[\s-]*eurit/i.test(s.name)) pinned = true;
      }



// 2️⃣ Send ALL pinned school media
if (pinned) {
  const img1 = twiml.message(
`⭐ *Pinned School: St Eurit International School*
👉 https://skoolfinder.net/register/st-eurit-international-school`
  );
  img1.media(`${site}/docs/st-eurit.jpg`);

  const img2 = twiml.message("📸 School Life at St Eurit");
  img2.media(`${site}/docs/st-eurit-pic2.jpg`);

  const pdf1 = twiml.message("📄 Registration Form");
  pdf1.media(`${site}/docs/st-eurit-registration.pdf`);

  const pdf2 = twiml.message("📘 Enrollment Requirements");
  pdf2.media(`${site}/docs/st-eurit-enrollment-requirements.pdf`);
}

// 3️⃣ ONLY AFTER ALL MEDIA — add back to menu
twiml.message(
`0️⃣ Back to menu
Type *hi*`
);
      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    /* ========== TUTOR SEARCH (UNCHANGED) ========== */
    if (user.chatState === "TUTOR_SEARCH") {

      if (lc === "0") {
        user.chatState = "HOME";
        await user.save();
        return send(res, "Back to menu.\n\nType *hi*");
      }

      if (!SUBJECTS[lc]) return send(res, "Choose 1–5 or 0.");

      const tutors = await Tutor.find({
        subjects: { $in: SUBJECTS[lc] },
        verified: true,
      }).limit(5);

      user.chatState = "HOME";
      await user.save();

      if (!tutors.length) {
        return send(res, "No tutors available yet.");
      }

     return send(
  res,
  tutors.map(t =>
`👤 ${t.name}
📚 ${t.subjects.join(", ")}
🎓 ${t.levels.join(", ")}
📍 ${t.city}
📞 ${t.phone}
📝 ${t.bio ? t.bio : "No bio provided yet."}`
  ).join("\n\n")
);

    }

    /* ========== TUTOR REGISTRATION & BIO (UNCHANGED) ========== */

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
      d.levels = lc === "1"
        ? ["Primary"]
        : lc === "2"
        ? ["High School"]
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

     user.chatState = "TUTOR_PAYMENT";
await user.save();

return send(
  res,
`💳 *Subscription Required*

To activate your tutor profile:
• Fee: *$5 USD per month*
• Payment method: *EcoCash*

📲 Steps:
1️⃣ Dial *151#
2️⃣ Select *Send Money*
3️⃣ Enter number: 0771446827
4️⃣ Amount: 5
5️⃣ Reference: C. Musasa

After payment, reply:
1️⃣ I have paid
0️⃣ Cancel`
);

    }

    if (user.chatState === "TUTOR_BIO") {
      await Tutor.updateOne({ phone }, { bio: body });

      user.chatState = "HOME";
      await user.save();

      return send(res, "✅ Bio updated successfully.\n\nType *hi*");
    }

    /* ========== TUTOR PAYMENT ========== */
if (user.chatState === "TUTOR_PAYMENT") {

  if (lc === "0") {
    user.chatState = "HOME";
    await user.save();
    return send(res, "❌ Payment cancelled.\n\nType *hi*");
  }

  if (lc === "1") {
    user.chatState = "HOME";
    await user.save();

    return send(
      res,
`✅ *Payment noted*

Your payment will be verified shortly.
Once confirmed, your tutor profile will appear in searches.

Type *hi*`
    );
  }

  return send(res, "Reply with 1️⃣ I have paid or 0️⃣ Cancel.");
}


//    return send(res, "Type *hi* to start.");

  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return send(res, "Something went wrong. Type *hi*.");
  }
});

export default router;
