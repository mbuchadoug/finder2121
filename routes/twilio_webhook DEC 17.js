import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ------------------------------------------------ */
/* Helpers                                          */
/* ------------------------------------------------ */

function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

/* ------------------------------------------------ */
/* Parse filters from words                         */
/* ------------------------------------------------ */

function parseFiltersFromWords(words) {
  const filters = {
    curriculum: [],
    type2: [],
    schoolPhase: [],
    learningEnvironment: "",
    gender: "",
    facilities: [],
  };

  const add = (arr, v) => {
    if (v && !arr.includes(v)) arr.push(v);
  };

  for (const raw of words) {
    const w = raw.toLowerCase();

    // Curriculum
    if (w === "cambridge") add(filters.curriculum, "Cambridge");
    if (w === "zimsec") add(filters.curriculum, "Zimsec");
    if (w === "ib") add(filters.curriculum, "IB");

    // Boarding / Day
    if (w === "boarding") add(filters.type2, "Boarding");
    if (w === "day") add(filters.type2, "Day");

    // Phase
    if (w === "primary") add(filters.schoolPhase, "Primary School");
    if (w === "high") add(filters.schoolPhase, "High School");
    if (w === "pre") add(filters.schoolPhase, "Pre-School");

    // Learning environment
    if (w === "advanced") filters.learningEnvironment = "Advanced";
    if (w === "enhanced") filters.learningEnvironment = "Enhanced";
    if (w === "comprehensive") filters.learningEnvironment = "Comprehensive";

    // Gender
    if (w === "boys") filters.gender = "Boys";
    if (w === "girls") filters.gender = "Girls";
    if (w === "mixed") filters.gender = "Mixed";

    // Facilities
    if (w === "science") add(filters.facilities, "scienceLabs");
    if (w === "computer") add(filters.facilities, "computerLab");
    if (w === "library") add(filters.facilities, "library");
    if (w === "steam") add(filters.facilities, "makerSpaceSteamLab");
    if (w === "swimming") add(filters.facilities, "swimmingPool");
    if (w === "rugby") add(filters.facilities, "rugbyField");
    if (w === "hockey") add(filters.facilities, "hockeyField");
    if (w === "tennis") add(filters.facilities, "tennisCourts");
    if (w === "basketball") add(filters.facilities, "basketballCourt");
    if (w === "football") add(filters.facilities, "footballPitch");
    if (w === "sen") add(filters.facilities, "learningSupportSEN");
    if (w === "clinic") add(filters.facilities, "schoolClinicNurse");
    if (w === "aftercare") add(filters.facilities, "aftercare");
    if (w === "transport") add(filters.facilities, "transportBuses");
    if (w === "wifi") add(filters.facilities, "wifiCampus");
    if (w === "cctv") add(filters.facilities, "cctvSecurity");
    if (w === "power") add(filters.facilities, "powerBackup");
  }

  return filters;
}

/* ------------------------------------------------ */
/* Main webhook                                     */
/* ------------------------------------------------ */

router.post("/webhook", async (req, res) => {
  try {
    const params = req.body || {};
    const rawFrom = String(params.From || "");
    const bodyRaw = String(params.Body || "").trim();
    const profileName = String(params.ProfileName || "");

    if (!rawFrom) return sendTwimlText(res, "Missing sender");

    const providerId = rawFrom.replace(/^whatsapp:/i, "");
    const phone = normalizePhone(providerId);

    /* -------- Load or create user -------- */

    let user = await User.findOne({ provider: "whatsapp", providerId });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        phone,
        name: profileName,
        role: "user",
      });
    }

    const lctext = bodyRaw.toLowerCase();

    /* ------------------------------------------------ */
    /* Main menu                                       */
    /* ------------------------------------------------ */

    const menu = [
      "👋 Welcome to *ZimEduFinder*",
      "",
      "Reply with a number or type your own search:",
      "",
      "1️⃣ Harare · Cambridge · Advanced · Science & ICT",
      "2️⃣ Harare · Cambridge · Boarding · Primary · Swimming",
      "3️⃣ Harare · Boarding · Sports focused",
      "4️⃣ Harare · Family schools · Swimming · Aftercare",
      "5️⃣ Harare · Girls schools · Advanced · Cambridge",
      "6️⃣ Harare · Boys schools · Boarding · Rugby",
      "7️⃣ Harare · SEN support · Primary · Day",
      "8️⃣ Harare · High schools · IB · Enhanced",
      "9️⃣ Harare · Day schools · Comprehensive",
      "",
      "✍️ Or type:",
      "find harare cambridge advanced swimming",
    ].join("\n");

    if (!lctext || ["hi", "hello", "menu"].includes(lctext)) {
      return sendTwimlText(res, menu);
    }

    /* ------------------------------------------------ */
    /* Numeric shortcuts                               */
    /* ------------------------------------------------ */

    let command = lctext;

    if (/^[1-9]$/.test(lctext)) {
      switch (lctext) {
        case "1":
          command = "find harare cambridge advanced science computer";
          break;
        case "2":
          command = "find harare cambridge boarding primary swimming";
          break;
        case "3":
          command = "find harare boarding rugby hockey football";
          break;
        case "4":
          command = "find harare mixed swimming aftercare";
          break;
        case "5":
          command = "find harare girls cambridge advanced";
          break;
        case "6":
          command = "find harare boys boarding rugby";
          break;
        case "7":
          command = "find harare primary sen day";
          break;
        case "8":
          command = "find harare high ib enhanced";
          break;
        case "9":
          command = "find harare day comprehensive";
          break;
      }
    }

    /* ------------------------------------------------ */
    /* FIND command                                    */
    /* ------------------------------------------------ */

    const parts = command.split(/\s+/);

    if (parts[0] === "find") {
      const city = (parts[1] || "harare").toLowerCase();
      const parsed = parseFiltersFromWords(parts.slice(2));

      const payload = {
        city: city.charAt(0).toUpperCase() + city.slice(1),
        curriculum: parsed.curriculum,
        type2: parsed.type2,
        schoolPhase: parsed.schoolPhase,
        learningEnvironment: parsed.learningEnvironment || undefined,
        gender: parsed.gender || undefined,
        facilities: parsed.facilities,
      };

      const site = process.env.SITE_URL.replace(/\/$/, "");

      const resp = await axios.post(`${site}/api/recommend`, payload);
      const recs = resp.data?.recommendations || [];

      if (!recs.length) {
        return sendTwimlText(res, "No schools found. Try another option.");
      }

      const twiml = new MessagingResponse();
      let attachStEurit = false;

      for (const r of recs.slice(0, 5)) {
        const msg = twiml.message(`🏫 ${r.name}`);
        if (r.website) msg.body += `\n🌐 ${r.website}`;

        const name = (r.name || "").toLowerCase();
        const slug = r.slug || "";

        if (/st[\s-]*eurit/.test(name) || /st-eurit/.test(slug)) {
          attachStEurit = true;
        }
      }

      /* -------- PINNED ST EURIT MEDIA -------- */

      if (attachStEurit) {
        const base = site;

        const img1 = twiml.message(
          "⭐ *Pinned school: St Eurit International School*\n👉 Register:\nhttps://skoolfinder.net/register/st-eurit-international-school"
        );
        img1.media(`${base}/docs/st-eurit.jpg`);

        const img2 = twiml.message("St Eurit campus");
        img2.media(`${base}/docs/st-eurit-pic2.jpg`);

        const pdf1 = twiml.message("📄 School Profile");
        pdf1.media(`${base}/docs/st-eurit-profile.pdf`);

        const pdf2 = twiml.message("📄 Registration Form");
        pdf2.media(`${base}/docs/st-eurit-registration.pdf`);

        const pdf3 = twiml.message("📄 Enrolment Requirements");
        pdf3.media(`${base}/docs/st-eurit-enrollment-requirements.pdf`);
      }

      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    return sendTwimlText(res, menu);
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendTwimlText(res, "Something went wrong. Type *hi* to restart.");
  }
});

export default router;
