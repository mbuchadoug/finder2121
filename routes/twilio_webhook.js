import express from "express";
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------------- HELPERS ---------------- */

function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.set("Content-Type", "text/xml");
  return res.status(200).send(twiml.toString());
}

function sendTwimlWithMedia(res, text, media = []) {
  const twiml = new MessagingResponse();
  const msg = twiml.message(text);
  media.forEach(m => msg.media(m));
  res.set("Content-Type", "text/xml");
  return res.status(200).send(twiml.toString());
}

function normalizePhone(p) {
  return String(p || "").replace(/^whatsapp:/, "").replace(/\D/g, "");
}

/* ---------------- SMART FILTER PARSER ---------------- */

function parseFilters(words) {
  const facilities = [
    "science","computer","library","robotics","cambridgecentre",
    "swimming","rugby","hockey","tennis","basketball","football",
    "counselling","sen","clinic","aftercare","transport","boarding"
  ];

  return {
    curriculum: words.filter(w => ["cambridge","zimsec","ib"].includes(w)),
    schoolPhase: words.find(w => ["preschool","primary","highschool"].includes(w)),
    type2: words.filter(w => ["day","boarding"].includes(w)),
    learningEnvironment: words.find(w => ["comprehensive","enhanced","advanced"].includes(w)),
    gender: words.find(w => ["boys","girls","mixed"].includes(w)),
    facilities: words.filter(w => facilities.includes(w))
  };
}

/* ---------------- MAIN WEBHOOK ---------------- */

router.post("/webhook", async (req, res) => {
  try {
    const bodyRaw = String(req.body.Body || "").trim();
    const rawFrom = normalizePhone(req.body.From);
    const profileName = req.body.ProfileName || "";

    if (!rawFrom) return sendTwimlText(res, "Missing sender.");

    /* ✅ SAVE USER ONCE */
    await User.findOneAndUpdate(
      { provider: "whatsapp", providerId: rawFrom },
      { $setOnInsert: { name: profileName, provider: "whatsapp", providerId: rawFrom } },
      { upsert: true, new: true }
    );

    const lctext = bodyRaw.toLowerCase();
    const words = lctext.split(/\s+/);

    /* ---------------- WELCOME / HELP ---------------- */

    if (!lctext || lctext === "hi" || lctext === "help") {
      return sendTwimlText(res, `
Hi! I’m ZimEduFinder 🤖

📍 FORMAT:
find [city] [filters]

🏙 Cities:
harare, bulawayo, mutare, gweru, masvingo

📘 Curriculum:
cambridge, zimsec, ib

🏫 Phase:
preschool, primary, highschool

🛏 Type:
day, boarding

🧠 Learning Environment:
comprehensive, enhanced, advanced

🚻 Gender:
boys, girls, mixed

🏊 Facilities:
science, computer, library, robotics, cambridgecentre,
swimming, rugby, hockey, tennis, basketball, football,
counselling, sen, clinic, aftercare, transport, boarding

✅ EXAMPLES:
find harare cambridge  
find harare primary girls  
find harare boarding swimming  
find harare cambridge advanced mixed  
find harare cambridge boarding primary enhanced girls swimming  

⭐ OTHER:
fav add <slug>
help
      `);
    }

    /* ---------------- FIND COMMAND ---------------- */

    if (words[0] === "find") {
      const city = words[1] || "harare";
      const parsed = parseFilters(words);

      const payload = {
        city,
        curriculum: parsed.curriculum,
        schoolPhase: parsed.schoolPhase,
        learningEnvironment: parsed.learningEnvironment,
        type2: parsed.type2,
        gender: parsed.gender,
        facilities: parsed.facilities
      };

      let resp;
      try {
        resp = await axios.post(`${process.env.SITE_URL}/api/recommend`, payload, { timeout: 10000 });
      } catch (err) {
        console.error("API ERROR:", err.message);
        return sendTwimlText(res, "⚠️ Search service temporarily unavailable.");
      }

      const recs = resp.data?.recommendations || [];
      if (!recs.length) {
        return sendTwimlText(res, "❌ No schools matched your filters. Try fewer filters.");
      }

      const pinned = recs.find(r => r.pinned === true);
      const others = recs.filter(r => r.pinned !== true);

      /* ✅ SEND ST EURIT MEDIA FIRST */
      if (pinned) {
        const media = [
          "https://skoolfinder.net/docs/st-eurit.jpg",
          "https://skoolfinder.net/docs/st-eurit-pic2.jpg",
          "https://skoolfinder.net/docs/st-eurit-profile.pdf",
          "https://skoolfinder.net/docs/st-eurit-registration.pdf",
          "https://skoolfinder.net/docs/st-eurit-enrollment-requirements.pdf"
        ];

        await sendTwimlWithMedia(
          res,
          `⭐ PINNED SCHOOL:\n${pinned.name}\nCurriculum: ${pinned.curriculum}\nRegister: https://skoolfinder.net${pinned.registerUrl}`,
          media
        );
        return;
      }

      /* ✅ SEND NORMAL LIST */
      const lines = [`Top matches for ${city}:`];
      others.slice(0, 5).forEach(s => {
        lines.push(`\n• ${s.name}\n  Curriculum: ${s.curriculum}\n  Website: ${s.website || "N/A"}`);
      });

      return sendTwimlText(res, lines.join("\n"));
    }

    return sendTwimlText(res, "❓ Unknown command. Type *help*.");

  } catch (err) {
    console.error("WEBHOOK CRASH:", err);
    return sendTwimlText(res, "⚠️ Server error. Try again.");
  }
});

export default router;
