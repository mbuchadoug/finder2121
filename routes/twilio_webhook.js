import express from "express";
import { Router } from "express";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ------------------ helpers ------------------ */

function sendTwiml(res, twiml) {
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function sendText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  return sendTwiml(res, twiml);
}

/* ------------------ main webhook ------------------ */

router.post("/webhook", async (req, res) => {
  try {
    const from = String(req.body.From || "");
    const body = String(req.body.Body || "").trim().toLowerCase();
    const profileName = String(req.body.ProfileName || "");

    if (!from) return sendText(res, "Missing sender info");

    const phone = from.replace(/^whatsapp:/, "");

    /* ---------- load or create user ---------- */
    let user = await User.findOne({ provider: "whatsapp", providerId: phone });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId: phone,
        name: profileName,
        lastState: "start",
      });
    }

    /* ---------- START / RESET ---------- */
    if (body === "hi" || body === "hello" || body === "menu" || !body) {
      user.lastState = "main_menu";
      await user.save();

      return sendText(
        res,
        [
          "👋 Welcome to *ZimEduFinder*",
          "",
          "What are you looking for today?",
          "",
          "1️⃣ Find Schools",
          "2️⃣ Find Private Tutors",
          "3️⃣ Help",
        ].join("\n")
      );
    }

    /* ---------- MAIN MENU ---------- */
    if (user.lastState === "main_menu") {
      if (body === "1") {
        user.lastState = "schools_menu";
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

      if (body === "2") {
        user.lastState = "tutors_info";
        await user.save();

        return sendText(
          res,
          [
            "👩‍🏫 *Private Tutors*",
            "",
            "Tutors can register via WhatsApp.",
            "Parents will soon be able to search by:",
            "- Subject",
            "- Grade",
            "- Location",
            "",
            "Reply *hi* to go back.",
          ].join("\n")
        );
      }

      if (body === "3") {
        return sendText(res, "Type *hi* to start again.");
      }

      return sendText(res, "Invalid option. Reply *hi* to restart.");
    }

    /* ---------- SCHOOLS MENU ---------- */
    if (user.lastState === "schools_menu") {
      let command = null;

      if (body === "1") command = "find harare cambridge advanced";
      if (body === "2") command = "find harare cambridge boarding primary";
      if (body === "3") command = "find harare boarding";
      if (body === "4") command = "find harare swimming";

      if (!command) return sendText(res, "Reply *hi* to restart.");

      user.lastState = "searching";
      await user.save();

      /* ---------- call your existing API ---------- */
      const site = process.env.SITE_URL;
      const resp = await axios.post(`${site}/api/recommend`, {
        query: command,
      });

      const recs = resp.data?.recommendations || [];

      const twiml = new MessagingResponse();

      let hasStEurit = false;

      for (const r of recs.slice(0, 5)) {
        if (/st[\s-]*eurit/i.test(r.name)) {
          hasStEurit = true;
        }
      }

      /* ---------- MEDIA (UNCHANGED, WORKING) ---------- */
      if (hasStEurit) {
        const base = site;

        const m1 = twiml.message(
          "⭐ *Pinned school: St Eurit International School*\nApply here:"
        );
        m1.media(`${base}/docs/st-eurit.jpg`);

        const m2 = twiml.message("School profile (PDF)");
        m2.media(`${base}/docs/st-eurit-profile.pdf`);

        const m3 = twiml.message("Registration form (PDF)");
        m3.media(`${base}/docs/st-eurit-registration.pdf`);
      }

      const lines = recs.slice(0, 5).map(
        (r) => `• ${r.name} | ${r.city || "harare"}`
      );

      twiml.message(lines.join("\n"));

      return sendTwiml(res, twiml);
    }

    /* ---------- FALLBACK ---------- */
    return sendText(res, "Something went wrong. Type *hi* to restart.");
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    return sendText(res, "Error occurred. Type *hi* to restart.");
  }
});

export default router;
