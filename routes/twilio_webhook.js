// routes/twilio_webhook.js
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import User from "../models/user.js";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

const router = Router();

/* -------------
   Helpers
   -------------*/
function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function toArraySafe(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // single non-string value
  return [String(v)];
}

/* Verify Twilio request. Use TWILIO_AUTH_TOKEN (subaccount token).
   If DEBUG_TWILIO_SKIP_VERIFY=1 or the token isn't set we skip verification
   (ONLY for local/dev testing). */
function verifyTwilioRequest(req) {
  if (process.env.DEBUG_TWILIO_SKIP_VERIFY === "1") {
    console.log("TWILIO_VERIFY: DEBUG skip enabled");
    return true;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn("TWILIO_AUTH_TOKEN not set — skipping Twilio signature verification (dev only)");
    return true;
  }

  try {
    const signature = req.header("x-twilio-signature");
    // Reconstruct the public URL Twilio used to call us. Respect X-Forwarded-Proto
    const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
    const host = req.get("host");
    if (!host) {
      console.warn("TWILIO_VERIFY: no host header; cannot verify");
      return false;
    }
    const url = `${proto}://${host}${req.originalUrl}`;
    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) {
      console.warn("TWILIO_VERIFY: validateRequest returned false for url =", url);
    }
    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY: validateRequest failed:", e?.message || e);
    return false;
  }
}

/* POST /webhook
   (If you mount router at /twilio in server.js this endpoint is /twilio/webhook) */
router.post("/webhook", async (req, res) => {
  try {
    console.log("TWILIO: incoming webhook", { path: req.path, ip: req.ip || req.connection?.remoteAddress });

    // verify signature
    if (!verifyTwilioRequest(req)) {
      return res.status(403).send("Invalid Twilio signature");
    }

    const params = req.body || {};
    const rawFrom = String(params.From || params.from || "");
    const bodyRaw = String(params.Body || params.body || "").trim();
    const profileName = String(params.ProfileName || params.profileName || "");

    console.log("TWILIO: parsed", { rawFrom, bodyRaw, profileName });

    if (!rawFrom) return sendTwimlText(res, "Missing sender info");

    const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();

    // upsert user if not exists (we will update lastPrefs separately using findOneAndUpdate)
    let user = await User.findOne({ provider: "whatsapp", providerId });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        name: profileName || undefined,
        role: "user",
      });
      console.log("TWILIO: created user", user._id.toString());
    } else if (profileName && user.name !== profileName) {
      user.name = profileName;
      await user.save();
      console.log("TWILIO: updated user name", user._id.toString());
    }

    const text = (bodyRaw || "").trim().toLowerCase();

    // greetings/help
    if (!text || ["hi", "hello", "hey"].includes(text)) {
      const reply =
        "Hi! I'm ZimEduFinder 🤖\n\nCommands:\n• find [city] — e.g. 'find harare'\n• find [city] boarding\n• fav add <slug>\n• help";
      return sendTwimlText(res, reply);
    }

    if (text === "help") {
      const reply =
        "ZimEduFinder Help:\n• find [city] [optional filters]\nExamples:\n• find harare\n• find harare boarding\n• fav add <slug>";
      return sendTwimlText(res, reply);
    }

    // handle find command
    const words = text.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      const city = words[1] || "Harare";
      const wantsBoarding = words.some((w) => /board|boarding/.test(w));
      const type2 = wantsBoarding ? ["Boarding"] : [];
      const curriculum = words.filter((w) => /cambridge|caie|zimsec|ib/.test(w));
      const facilities = []; // TODO: parse other keywords into facility keys if desired

      // Build a clean prefs object (ensure arrays are arrays)
      const prefs = {
        city: String(city),
        curriculum: toArraySafe(curriculum),
        type: [], // not parsed in current CLI; left blank
        type2: toArraySafe(type2),
        facilities: toArraySafe(facilities),
      };

      // Save lastPrefs safely with findOneAndUpdate (avoids casting issues when DB has old shape)
      await User.findOneAndUpdate(
        { provider: "whatsapp", providerId },
        { $set: { lastPrefs: prefs } },
        { new: true, upsert: false }
      ).catch((e) => {
        console.error("TWILIO: failed to set lastPrefs:", e && e.message ? e.message : e);
      });

      // call /api/recommend on your site
      let data;
      try {
        const site = (process.env.SITE_URL || "").replace(/\/$/, "");
        if (!site) throw new Error("SITE_URL not configured");
        const url = `${site}/api/recommend`;
        const resp = await axios.post(url, {
          city: prefs.city,
          learningEnvironment: undefined,
          curriculum: prefs.curriculum,
          type: prefs.type,
          type2: prefs.type2,
          facilities: prefs.facilities,
        }, { timeout: 8000 });
        data = resp.data;
      } catch (e) {
        console.error("TWILIO: recommend call failed:", e?.message || e);
        return sendTwimlText(res, "Search failed — please try again later.");
      }

      const recs = (data && data.recommendations) || [];
      if (!recs.length) {
        return sendTwimlText(res, `No matches found for "${prefs.city}". Try 'find harare' or 'help'.`);
      }

      const lines = [`Top ${Math.min(5, recs.length)} matches for ${prefs.city}:`];
      for (const r of recs.slice(0, 5)) {
        const registerUrl =
          r.registerUrl || (r.slug ? `${process.env.SITE_URL || ""}/register/${encodeURIComponent(r.slug)}` : "");
        lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);
        if (r.website) lines.push(`  Website: ${r.website}`);
        if (registerUrl) lines.push(`  Register: ${registerUrl}`);
      }
      lines.push("\nReply 'help' for commands.");
      return sendTwimlText(res, lines.join("\n"));
    }

    // fav add
    if (text.startsWith("fav add ") || text.startsWith("favorite add ")) {
      const slug = bodyRaw.split(/\s+/).slice(2).join(" ").trim();
      if (!slug) return sendTwimlText(res, "Please provide the school slug, e.g. 'fav add st-eurit-international-school'");

      try {
        const site = (process.env.SITE_URL || "").replace(/\/$/, "");
        const resp = await axios.get(`${site}/api/school-by-slug/${encodeURIComponent(slug)}`, { timeout: 5000 }).catch(() => null);
        const school = resp && resp.data && resp.data.school;
        if (!school) return sendTwimlText(res, `School not found for slug "${slug}"`);
        await User.findOneAndUpdate({ provider: "whatsapp", providerId }, { $addToSet: { favourites: school._id } }, { upsert: true });
        return sendTwimlText(res, `Added "${school.name}" to your favourites.`);
      } catch (e) {
        console.error("TWILIO: fav add error:", e?.message || e);
        return sendTwimlText(res, "Could not add favourite — try again later.");
      }
    }

    // fallback
    return sendTwimlText(res, "Sorry, I didn't understand. Send 'help' for usage.");
  } catch (err) {
    console.error("TWILIO: webhook error:", err && err.stack ? err.stack : err);
    return sendTwimlText(res, "Server error; try again later.");
  }
});

export default router;
