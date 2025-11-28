// routes/twilio_webhook.js  (replace your existing file)
import express from "express";
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js"; // ensure this path matches your project

const router = Router();

// Ensure router parses form-encoded bodies (Twilio uses application/x-www-form-urlencoded)
router.use(express.urlencoded({ extended: true }));

function sendTwimlText(res, text) {
  try {
    const twiml = new MessagingResponse();
    twiml.message(text || "");
    res.set("Content-Type", "text/xml");
    return res.send(twiml.toString());
  } catch (e) {
    // fallback
    res.set("Content-Type", "text/plain");
    return res.send(String(text || ""));
  }
}

function toArraySafe(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

function verifyTwilioRequest(req) {
  if (process.env.DEBUG_TWILIO_SKIP_VERIFY === "1") {
    console.log("TWILIO_VERIFY: DEBUG skip enabled");
    return true;
  }
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn("TWILIO_VERIFY: TWILIO_AUTH_TOKEN not set — skipping verification (dev)");
    return true;
  }
  try {
    const signature = req.header("x-twilio-signature");
    const configuredSite = (process.env.SITE_URL || "").replace(/\/$/, "");
    let url;
    if (configuredSite) {
      url = `${configuredSite}${req.originalUrl}`;
    } else {
      const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
      const host = req.get("host");
      if (!host) {
        console.warn("TWILIO_VERIFY: no host header; cannot verify");
        return false;
      }
      url = `${proto}://${host}${req.originalUrl}`;
    }
    // Important: Twilio expects the *raw* params used in the signature check.
    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) console.warn("TWILIO_VERIFY: signature invalid for", url, "signature:", signature);
    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY: error:", e?.message || e);
    return false;
  }
}

router.post("/webhook", async (req, res) => {
  // Aggressive top-level logging to ensure we see everything
  console.log("TWILIO: webhook hit ->", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
  console.log("TWILIO: debug env:", {
    SITE_URL: process.env.SITE_URL ? "[set]" : "[missing]",
    DEBUG_TWILIO_SKIP_VERIFY: process.env.DEBUG_TWILIO_SKIP_VERIFY || "[not set]",
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? "[set]" : "[missing]"
  });

  console.log("TWILIO: headers:", {
    host: req.get("host"),
    "x-forwarded-proto": req.get("x-forwarded-proto"),
    "x-twilio-signature": req.header("x-twilio-signature"),
    "content-type": req.get("content-type"),
  });

  // Print body safely (avoid circular)
  try {
    console.log("TWILIO: body (raw):", JSON.stringify(req.body));
  } catch (e) {
    console.log("TWILIO: body (raw) - non-serializable; keys:", Object.keys(req.body || {}));
  }

  // Verify
  const ok = verifyTwilioRequest(req);
  if (!ok) {
    console.warn("TWILIO: request verification failed -> replying 403 (signature mismatch or missing headers)");
    // Respond with TwiML too so Twilio gets a valid response body even if 403
    res.status(403);
    return sendTwimlText(res, "Invalid Twilio signature");
  }

  // From here onward we have a verified request (or skip enabled)
  try {
    const params = req.body || {};
    const rawFrom = String(params.From || params.from || "");
    const bodyRaw = String(params.Body || params.body || "").trim();
    const profileName = String(params.ProfileName || params.profileName || "");
    console.log("TWILIO: parsed", { rawFrom, bodyRaw, profileName });

    if (!rawFrom) {
      console.warn("TWILIO: missing From");
      return sendTwimlText(res, "Missing sender info");
    }

    const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();

    // ensure user exists and keep name updated
    let user = await User.findOne({ provider: "whatsapp", providerId });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        name: profileName || undefined,
        role: "user",
      });
      console.log("TWILIO: created user", user._id?.toString());
    } else if (profileName && user.name !== profileName) {
      user.name = profileName;
      await user.save();
      console.log("TWILIO: updated user name", user._id?.toString());
    }

    const text = (bodyRaw || "").trim();
    const lctext = text.toLowerCase();

    // BASIC commands: greeting/help -> reply immediately
    if (!lctext || ["hi", "hello", "hey"].includes(lctext)) {
      const reply =
        "Hi! I'm ZimEduFinder 🤖\n\nCommands:\n• find [city] [filters]\n   e.g. 'find harare cambridge boarding primary urban'\n• fav add <slug>\n• help";
      return sendTwimlText(res, reply);
    }

    if (lctext === "help") {
      const reply =
        "ZimEduFinder Help:\n• find [city] [filters]\nFilters: curriculum (cambridge, zimsec, ib), boarding/day, phase (primary/secondary/preschool), environment (urban/suburban/rural)\nExamples:\n• find harare cambridge boarding primary urban\n• find bulawayo zimsec day secondary";
      return sendTwimlText(res, reply);
    }

    // find command
    const words = lctext.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      const city = words[1] || "Harare";
      const wantsBoarding = words.some((w) => /board|boarding/.test(w));
      const type2 = wantsBoarding ? ["Boarding"] : [];
      const curriculum = words.filter((w) => /cambridge|caie|zimsec|ib/.test(w));
      const facilities = [];

      // Build a plain object for lastPrefs (fixes earlier CastError where an array was being saved)
      // --- replace the current lastPrefs save block with this ---
const lastPrefs = {
  city: String(city),
  curriculum: Array.isArray(curriculum) ? curriculum.map(String) : toArraySafe(curriculum),
  learningEnvironment: undefined,
  schoolPhase: undefined,
  type2: Array.isArray(type2) ? type2.map(String) : toArraySafe(type2),
  facilities: [], // placeholder
};

// defensive logging so we can see exactly what gets written
try {
  console.log("TWILIO: about to save lastPrefs (type check):", {
    providerId,
    lastPrefsType: typeof lastPrefs,
    lastPrefsIsArray: Array.isArray(lastPrefs),
    lastPrefsPreview: JSON.stringify(lastPrefs).slice(0, 1000)
  });

  await User.findOneAndUpdate(
    { provider: "whatsapp", providerId },
    { $set: { lastPrefs } }, // important: set to object (not array)
    { new: true, upsert: true }
  );
  console.log("TWILIO: lastPrefs saved for", providerId);
} catch (e) {
  // make the error message fully visible in logs
  console.error("TWILIO: failed saving lastPrefs:", e && (e.stack || e.message) ? (e.stack || e.message) : e);
};

      try {
        // Save as an object (not an array) to match your schema
        await User.findOneAndUpdate(
          { provider: "whatsapp", providerId },
          { $set: { lastPrefs } },
          { new: true, upsert: true }
        );
        console.log("TWILIO: lastPrefs saved for", providerId, lastPrefs);
      } catch (e) {
        console.error("TWILIO: failed saving lastPrefs:", e && e.message ? e.message : e);
      }

      // call recommend endpoint
      try {
        const site = (process.env.SITE_URL || "").replace(/\/$/, "");
        if (!site) throw new Error("SITE_URL not configured");
        const resp = await axios.post(`${site}/api/recommend`, {
          city: lastPrefs.city,
          curriculum: lastPrefs.curriculum,
          learningEnvironment: lastPrefs.learningEnvironment,
          schoolPhase: lastPrefs.schoolPhase,
          type2: lastPrefs.type2,
          facilities: lastPrefs.facilities,
        }, { timeout: 10000 });

        const recs = (resp.data && resp.data.recommendations) || [];
        if (!recs.length) {
          return sendTwimlText(res, `No matches found for "${city}" with those filters. Try fewer filters or 'help'.`);
        }

        const lines = [`Top ${Math.min(5, recs.length)} matches for ${city}:`];
        for (const r of recs.slice(0, 5)) {
          lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);
          if (r.curriculum) lines.push(`  Curriculum: ${Array.isArray(r.curriculum) ? r.curriculum.join(", ") : r.curriculum}`);
          if (r.fees) lines.push(`  Fees: ${r.fees}`);
          if (r.website) lines.push(`  Website: ${r.website}`);
          // Only show register link for St Eurit
          const name = (r.name || "").toLowerCase();
          if (/st[\s-]*eurit/.test(name) || (r.slug && /st-eurit/.test(r.slug))) {
          const registerUrl = "https://skoolfinder.net/register/st-eurit-international-school";

            if (registerUrl) lines.push(`  Register: ${registerUrl}`);
          }
        }
        lines.push("\nReply 'help' for commands.");
        return sendTwimlText(res, lines.join("\n"));
      } catch (e) {
        console.error("TWILIO: recommend call failed:", e && (e.message || (e.response && JSON.stringify(e.response.data))) ? (e.message || JSON.stringify(e.response.data)) : e);
        return sendTwimlText(res, "Search failed — please try again later.");
      }
    }

    // fav add
    if (lctext.startsWith("fav add ") || lctext.startsWith("favorite add ")) {
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
        console.error("TWILIO: fav add error:", e && e.message ? e.message : e);
        return sendTwimlText(res, "Could not add favourite — try again later.");
      }
    }

    // fallback
    return sendTwimlText(res, "Sorry, I didn't understand. Send 'help' for usage.");
  } catch (err) {
    console.error("TWILIO: webhook handler error:", err && err.stack ? err.stack : err);
    try {
      return sendTwimlText(res, "Server error; try again later.");
    } catch (e) {
      return res.status(500).end();
    }
  }
});

export default router;
