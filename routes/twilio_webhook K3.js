// routes/twilio_webhook.js
import express from "express";
import { Router } from "express";
import twilio from "twilio";
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

/* ---------- Main Webhook ---------- */

router.post("/webhook", async (req, res) => {
  try {
    const params = req.body || {};
    const rawFrom = String(params.From || "");
    const bodyRaw = String(params.Body || "").trim();
    const profileName = String(params.ProfileName || "");

    if (!rawFrom) return sendTwimlText(res, "Missing sender info");

    const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();
    const providerIdNormalized = normalizePhone(providerId);

    let user = await User.findOne({ provider: "whatsapp", providerId });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        name: profileName || undefined,
        role: "user",
      });
    }

    const text = bodyRaw.trim();
    const lctext = text.toLowerCase();

    if (!lctext || ["hi", "hello", "hey"].includes(lctext)) {
      return sendTwimlText(
        res,
        "Hi! I'm ZimEduFinder \n\nCommands:\n• find [city] [filters]\n   e.g. find harare cambridge boarding primary urban\n• help"
      );
    }

    if (lctext === "help") {
      return sendTwimlText(
        res,
        "ZimEduFinder Help:\n• find [city] [filters]\nExamples:\n• find harare cambridge boarding primary urban"
      );
    }

    /* ---------- FIND COMMAND ---------- */

    const words = lctext.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      const city = words[1] || "Harare";
      const wantsBoarding = words.some((w) => /board|boarding/.test(w));
      const type2 = wantsBoarding ? ["Boarding"] : [];
      const curriculum = words.filter((w) =>
        /cambridge|caie|zimsec|ib/.test(w)
      );

      const site = process.env.SITE_URL.replace(/\/$/, "");

      const resp = await axios.post(`${site}/api/recommend`, {
        city,
        curriculum,
        type2,
      });

      const recs = resp.data.recommendations || [];
      if (!recs.length)
        return sendTwimlText(res, "No schools found.");

      const lines = [`Top ${Math.min(5, recs.length)} matches for ${city}:`];

      let attachStEuritMedia = false;

      for (const r of recs.slice(0, 5)) {
        lines.push(`\n• ${r.name} | ${r.city}`);
        if (r.curriculum)
          lines.push(
            `  Curriculum: ${Array.isArray(r.curriculum)
              ? r.curriculum.join(", ")
              : r.curriculum}`
          );
        if (r.website) lines.push(`  Website: ${r.website}`);

        const name = (r.name || "").toLowerCase();
        const slug = r.slug || "";

        if (
          /st[\s-]*eurit/.test(name) ||
          /st-eurit/.test(slug)
        ) {
          attachStEuritMedia = true;
          lines.push(
            `  Register: https://skoolfinder.net/register/st-eurit-international-school`
          );
        }
      }

      const twiml = new MessagingResponse();

      /* ---------- MEDIA FIRST (ONLY ST EURIT) ---------- */

      if (attachStEuritMedia) {
        const mediaBase = site;

        const img1 = twiml.message("St Eurit International School");
        img1.media(`${mediaBase}/docs/st-eurit.jpg`);

        const img2 = twiml.message("St Eurit Internaational School");
        img2.media(`${mediaBase}/docs/st-eurit-pic2.jpg`);

        const pdf1 = twiml.message("St Eurit | School Profile (PDF)");
        pdf1.media(`${mediaBase}/docs/st-eurit-profile.pdf`);

        const pdf2 = twiml.message("St Eurit | Registration Form (PDF)");
        pdf2.media(`${mediaBase}/docs/st-eurit-registration.pdf`);

        const pdf3 = twiml.message("St Eurit | Enrolment Requirements (PDF)");
        pdf3.media(
          `${mediaBase}/docs/st-eurit-enrollment-requirements.pdf`
        );
      }

      /* ---------- TEXT LIST LAST ---------- */
      twiml.message(lines.join("\n"));

      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    return sendTwimlText(res, "Unknown command. Send 'help'.");
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendTwimlText(res, "Server error. Try again.");
  }
});

export default router;
