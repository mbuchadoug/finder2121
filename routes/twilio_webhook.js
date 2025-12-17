// routes/twilio_webhook.js
import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------- Helpers ---------- */

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

/* ---------- FILTER PARSER (UNCHANGED – WORKING) ---------- */

function parseFiltersFromWords(words) {
  const filters = {
    curriculum: [],
    type2: [],
    schoolPhase: [],
    learningEnvironment: "",
    gender: "",
    facilities: [],
  };

  const add = (arr, v) => !arr.includes(v) && arr.push(v);

  for (const raw of words) {
    const w = raw.toLowerCase();

    if (["cambridge","cam"].includes(w)) add(filters.curriculum,"Cambridge");
    if (w === "zimsec") add(filters.curriculum,"Zimsec");
    if (w === "ib") add(filters.curriculum,"IB");

    if (w === "boarding") add(filters.type2,"Boarding");
    if (w === "day") add(filters.type2,"Day");

    if (["pre","preschool"].includes(w)) add(filters.schoolPhase,"Pre-School");
    if (["primary"].includes(w)) add(filters.schoolPhase,"Primary School");
    if (["high","secondary"].includes(w)) add(filters.schoolPhase,"High School");

    if (["comprehensive"].includes(w)) filters.learningEnvironment="Comprehensive";
    if (["enhanced"].includes(w)) filters.learningEnvironment="Enhanced";
    if (["advanced"].includes(w)) filters.learningEnvironment="Advanced";

    if (w === "boys") filters.gender="Boys";
    if (w === "girls") filters.gender="Girls";
    if (w === "mixed") filters.gender="Mixed";

    if (["science","lab","labs"].includes(w)) add(filters.facilities,"scienceLabs");
    if (["computer","ict"].includes(w)) add(filters.facilities,"computerLab");
    if (["library"].includes(w)) add(filters.facilities,"library");
    if (["robotics","steam"].includes(w)) add(filters.facilities,"makerSpaceSteamLab");
    if (["swimming","pool"].includes(w)) add(filters.facilities,"swimmingPool");
    if (["rugby"].includes(w)) add(filters.facilities,"rugbyField");
    if (["football","soccer"].includes(w)) add(filters.facilities,"footballPitch");
    if (["transport","bus"].includes(w)) add(filters.facilities,"transportBuses");
    if (["clinic","nurse"].includes(w)) add(filters.facilities,"schoolClinicNurse");
    if (["aftercare"].includes(w)) add(filters.facilities,"aftercare");
    if (["sen"].includes(w)) add(filters.facilities,"learningSupportSEN");
  }

  return filters;
}

/* ---------- MAIN WEBHOOK ---------- */

router.post("/webhook", async (req, res) => {
  try {
    const rawFrom = String(req.body.From || "");
    const bodyRaw = String(req.body.Body || "").trim();
    const profileName = String(req.body.ProfileName || "");

    if (!rawFrom) return sendTwimlText(res, "Missing sender info");

    const providerId = rawFrom.replace(/^whatsapp:/i,"");
    const phone = normalizePhone(providerId);

    let user = await User.findOne({ provider:"whatsapp", providerId });
    if (!user) {
      user = await User.create({
        provider:"whatsapp",
        providerId,
        phone,
        name: profileName,
        role:"user",
        firstSeenAt:new Date(),
        lastSeenAt:new Date()
      });
    }

    const text = bodyRaw.toLowerCase();

    /* ---------- MENU ---------- */

    const menu = [
      "👋 *Welcome to ZimEduFinder*",
      "",
      "Reply with a number or type your own search:",
      "",
      "1️⃣ Harare · Cambridge · Advanced · Science & ICT",
      "2️⃣ Harare · Cambridge · Boarding · Primary · Swimming",
      "3️⃣ Harare · Boarding · Any curriculum · Sports focused",
      "4️⃣ Harare · Family schools · Swimming · Aftercare",
      "5️⃣ Harare · Girls schools · Advanced · Cambridge",
      "6️⃣ Harare · Boys schools · Rugby · Boarding",
      "7️⃣ Harare · SEN support · Primary · Day",
      "8️⃣ Harare · High schools · IB · Enhanced",
      "9️⃣ Harare · Affordable · Day · Comprehensive",
      "",
      "✍️ Or type:",
      "find harare cambridge advanced swimming"
    ].join("\n");

    if (!text || ["hi","hello","menu"].includes(text)) {
      return sendTwimlText(res, menu);
    }

    /* ---------- NUMERIC → RICH COMMANDS ---------- */

    let command = text;

    const quickMap = {
      "1": "find harare cambridge advanced science computer",
      "2": "find harare cambridge boarding primary swimming",
      "3": "find harare boarding rugby football",
      "4": "find harare day swimming aftercare",
      "5": "find harare cambridge advanced girls",
      "6": "find harare boarding boys rugby",
      "7": "find harare primary sen day",
      "8": "find harare high ib enhanced",
      "9": "find harare day comprehensive"
    };

    if (quickMap[text]) {
      command = quickMap[text];
    }

    /* ---------- FIND ---------- */

    const words = command.split(" ");
    if (words[0] === "find") {
      const city = words[1] || "harare";
      const parsed = parseFiltersFromWords(words.slice(2));

      const site = process.env.SITE_URL.replace(/\/$/,"");
      const resp = await axios.post(`${site}/api/recommend`,{
        city: city.charAt(0).toUpperCase()+city.slice(1),
        ...parsed
      });

      const recs = resp.data.recommendations || [];
      if (!recs.length) {
        return sendTwimlText(res,"No schools found. Try another option.");
      }

      const twiml = new MessagingResponse();

      for (const r of recs.slice(0,5)) {
        twiml.message(`🏫 ${r.name}\n${r.website || ""}`);
      }

      res.set("Content-Type","text/xml");
      return res.send(twiml.toString());
    }

    return sendTwimlText(res, menu);

  } catch (e) {
    console.error("TWILIO ERROR", e);
    return sendTwimlText(res,"Something went wrong. Type *hi* to restart.");
  }
});

export default router;
