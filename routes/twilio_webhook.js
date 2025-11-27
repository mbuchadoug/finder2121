// routes/twilio_webhook.js
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import User from "../models/user.js";

const router = Router();

// TwiML helper using Twilio SDK
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

function twimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

/**
 * Verify Twilio request (recommended for production)
 * Uses TWILIO_AUTH_TOKEN and SITE_URL env var.
 */
function verifyTwilioRequest(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn("TWILIO_AUTH_TOKEN not set — skipping Twilio signature verification (dev only)");
    return true;
  }
  try {
    const signature = req.header("x-twilio-signature");
    const site = (process.env.SITE_URL || "").replace(/\/$/, "");
    const url = site + req.originalUrl; // exact URL Twilio calls
    const params = Object.assign({}, req.body);
    return twilio.validateRequest(authToken, signature, url, params);
  } catch (e) {
    console.warn("twilio.validateRequest failed:", e?.message || e);
    return false;
  }
}

/**
 * Call your /api/recommend endpoint so matching logic stays DRY
 * payload should be the same shape your API expects
 */
async function callRecommend(payload) {
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const url = `${site}/api/recommend`;
  const resp = await axios.post(url, payload, { timeout: 8000 });
  return resp.data;
}

/* POST /webhooks/twilio */
router.post("/webhooks/twilio", async (req, res) => {
  try {
    // 1) Verify Twilio signature
    if (!verifyTwilioRequest(req)) {
      return res.status(403).send("Invalid Twilio signature");
    }

    const params = req.body || {};
    // Twilio sends From like "whatsapp:+263784277776"
    const rawFrom = String(params.From || params.from || "");
    const bodyRaw = String(params.Body || params.body || "").trim();
    const profileName = String(params.ProfileName || params.profileName || "");

    if (!rawFrom) return twimlText(res, "Missing sender info");

    const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();

    // Upsert user
    let user = await User.findOne({ provider: "whatsapp", providerId });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        name: profileName || undefined,
        role: "user",
      });
    } else if (profileName && user.name !== profileName) {
      user.name = profileName;
      await user.save();
    }

    const text = (bodyRaw || "").trim().toLowerCase();

    // Greeting/help
    if (!text || ["hi", "hello", "hey"].includes(text)) {
      const reply =
        "Hi! I'm ZimEduFinder 🤖\n\nCommands:\n• find [city] — e.g. 'find harare'\n• find [city] boarding\n• help";
      return twimlText(res, reply);
    }

    if (text === "help") {
      const reply =
        "ZimEduFinder Help:\n• find [city] [optional filters]\nExamples:\n• find harare\n• find harare boarding\n• find harare cambridge swimmingPool";
      return twimlText(res, reply);
    }

    // find command -> call /api/recommend
    const words = text.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      const city = words[1] || "Harare";
      const type2 = words.some((w) => /board|boarding/.test(w)) ? ["Boarding"] : [];
      const curriculum = words.filter((w) => /cambridge|caie|zimsec|ib/.test(w));
      const facilities = []; // optional: parse additional words like swimmingPool etc.

      // save lastPrefs
      user.lastPrefs = {
        city,
        learningEnvironment: undefined,
        curriculum,
        type: [],
        type2,
        facilities,
      };
      await user.save();

      let data;
      try {
        data = await callRecommend({
          city,
          learningEnvironment: undefined,
          curriculum,
          type: [],
          type2,
          facilities,
        });
      } catch (e) {
        console.error("recommend call failed:", e?.message || e);
        return twimlText(res, "Search failed — please try again later.");
      }

      const recs = (data && data.recommendations) || [];
      if (!recs.length) {
        return twimlText(res, `No matches found for "${city}". Try 'find harare' or 'help'.`);
      }

      const lines = [`Top ${Math.min(5, recs.length)} matches for ${city}:`];
      for (const r of recs.slice(0, 5)) {
        const registerUrl =
          r.registerUrl || (r.slug ? `${process.env.SITE_URL || ""}/register/${encodeURIComponent(r.slug)}` : "");
        lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);
        if (r.website) lines.push(`  Website: ${r.website}`);
        if (registerUrl) lines.push(`  Register: ${registerUrl}`);
      }
      lines.push("\nReply 'help' for commands.");

      return twimlText(res, lines.join("\n"));
    }

    // fav add <slug> flow (simple)
    if (text.startsWith("fav add ") || text.startsWith("favorite add ")) {
      const slug = bodyRaw.split(/\s+/).slice(2).join(" ").trim();
      if (!slug) return twimlText(res, "Please provide the school slug, e.g. 'fav add st-eurit-international-school'");

      try {
        // Try fetch school by slug via internal API; you can swap to direct model import if desired
        const site = (process.env.SITE_URL || "").replace(/\/$/, "");
        const resp = await axios.get(`${site}/api/school-by-slug/${encodeURIComponent(slug)}`, { timeout: 5000 }).catch(() => null);
        const school = resp && resp.data && resp.data.school;
        if (!school) return twimlText(res, `School not found for slug "${slug}"`);
        await User.findOneAndUpdate({ provider: "whatsapp", providerId }, { $addToSet: { favourites: school._id } }, { upsert: true });
        return twimlText(res, `Added "${school.name}" to your favourites.`);
      } catch (e) {
        console.error("fav add error:", e?.message || e);
        return twimlText(res, "Could not add favourite — try again later.");
      }
    }

    // fallback
    return twimlText(res, "Sorry, I didn't understand. Send 'help' for usage.");
  } catch (err) {
    console.error("twilio webhook error:", err);
    return twimlText(res, "Server error; try again later.");
  }
});

export default router;
