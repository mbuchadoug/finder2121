// routes/twilio_webhook.js
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import User from "../models/userCopy.js";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

const router = Router();

function toArraySafe(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

/**
 * Verify Twilio request.
 * Uses SITE_URL if configured (recommended), otherwise reconstructs from x-forwarded-proto / req.protocol + host.
 */
import crypto from "crypto";

/**
 * Debuggable Twilio signature verification.
 * - Logs URL used for verification
 * - Logs incoming signature header
 * - Computes expected signature (HMAC-SHA1 of url + sorted params) and logs it
 * - Returns boolean
 *
 * IMPORTANT: don't leave verbose secret logging enabled in production long-term.
 */
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
    const signatureHeader = req.header("x-twilio-signature") || "<none>";
    const configuredSite = (process.env.SITE_URL || "").replace(/\/$/, "");
    let url;
    if (configuredSite) {
      // Use SITE_URL override when available (recommended)
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

    // Clone and normalize params: Twilio signs on the post body form fields
    const params = Object.assign({}, req.body || {});
    // Build Twilio sorting: lexicographically by key, append value(s) as string
    const keys = Object.keys(params).sort();
    let dataToSign = url;
    for (const k of keys) {
      const v = params[k];
      // If value is an array (shouldn't be for Twilio form posts), join it
      const vs = Array.isArray(v) ? v.join("") : String(v == null ? "" : v);
      dataToSign += k + vs;
    }

    // Compute expected signature (HMAC-SHA1, base64)
    const hmac = crypto.createHmac("sha1", authToken);
    hmac.update(dataToSign, "utf8");
    const expectedSig = hmac.digest("base64");

    // Log debug info (truncate params and mask token)
    const safeParams = {};
    for (const k of keys) {
      let val = params[k];
      if (typeof val === "string" && val.length > 200) val = val.slice(0, 200) + "...(truncated)";
      safeParams[k] = val;
    }

    console.log("TWILIO_VERIFY: signature header:", signatureHeader);
    console.log("TWILIO_VERIFY: using URL:", url);
    console.log("TWILIO_VERIFY: params keys:", keys);
    console.log("TWILIO_VERIFY: params (sample):", safeParams);
    console.log("TWILIO_VERIFY: computed expectedSig:", expectedSig);
    console.log("TWILIO_VERIFY: authToken masked:", `***${String(authToken).slice(-4)}`);

    // Compare header to computed signature
    const ok = signatureHeader === expectedSig;
    if (!ok) {
      console.warn("TWILIO_VERIFY: signature mismatch — header !== expectedSig");
      // Also try twilio.validateRequest for cross-check (same result, but good to log)
      try {
        const twilioOk = twilio.validateRequest(authToken, signatureHeader, url, params);
        console.log("TWILIO_VERIFY: twilio.validateRequest returned:", twilioOk);
      } catch (e) {
        console.warn("TWILIO_VERIFY: twilio.validateRequest threw:", e?.message || e);
      }
    } else {
      console.log("TWILIO_VERIFY: signature valid");
    }

    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY: error:", e?.message || e);
    return false;
  }
}


/**
 * Helper: respond with TwiML text and end request
 */
function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

/* POST /webhook  (mounted under /twilio in server.js -> full path: /twilio/webhook) */
router.post("/webhook", async (req, res) => {
  try {
    // Log inbound request (helpful)
    console.log("TWILIO: incoming webhook", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
    console.log("TWILIO: headers:", {
      host: req.get("host"),
      "x-forwarded-proto": req.get("x-forwarded-proto"),
      "x-twilio-signature": req.header("x-twilio-signature"),
      "content-type": req.get("content-type"),
    });
    console.log("TWILIO: body (raw):", req.body);

    // Verify request first (preferred)
    const ok = verifyTwilioRequest(req);
    if (!ok) {
      // respond with 403 so Twilio sees verification failure
      console.warn("TWILIO: request verification failed");
      return res.status(403).send("Invalid Twilio signature");
    }

    // parse fields
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

    const text = (bodyRaw || "").trim().toLowerCase();

    // Greeting/help -> reply immediately
    if (!text || ["hi", "hello", "hey"].includes(text)) {
      const reply =
        "Hi! I'm ZimEduFinder 🤖\n\nCommands:\n• find [city] — e.g. 'find harare'\n• find [city] boarding\n• fav add <slug>\n• help";
      return sendTwimlText(res, reply);
    }

    if (text === "help") {
      const reply =
        "ZimEduFinder Help:\n• find [city] [optional filters]\nExamples:\n• find harare\n• find harare boarding\n• fav add st-eurit-international-school";
      return sendTwimlText(res, reply);
    }

    // find command -> call /api/recommend and reply with top matches
    const words = text.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      const city = words[1] || "Harare";
      const wantsBoarding = words.some((w) => /board|boarding/.test(w));
      const type2 = wantsBoarding ? ["Boarding"] : [];
      const curriculum = words.filter((w) => /cambridge|caie|zimsec|ib/.test(w));
      const facilities = [];

      // persist lastPrefs as simple object (not array) to avoid schema cast errors
      try {
        await User.findOneAndUpdate(
          { provider: "whatsapp", providerId },
          { $set: { lastPrefs: { city: String(city), curriculum: toArraySafe(curriculum), type2: toArraySafe(type2), facilities: toArraySafe(facilities) } } },
          { new: true }
        );
        console.log("TWILIO: lastPrefs saved for", providerId);
      } catch (e) {
        console.error("TWILIO: failed saving lastPrefs:", e && e.message ? e.message : e);
      }

      // call recommend endpoint
      try {
        const site = (process.env.SITE_URL || "").replace(/\/$/, "");
        if (!site) throw new Error("SITE_URL not configured");
        const resp = await axios.post(`${site}/api/recommend`, {
          city,
          learningEnvironment: undefined,
          curriculum,
          type: [],
          type2,
          facilities,
        }, { timeout: 8000 });

        const recs = (resp.data && resp.data.recommendations) || [];
        if (!recs.length) {
          return sendTwimlText(res, `No matches found for "${city}". Try 'find harare' or 'help'.`);
        }

        const lines = [`Top ${Math.min(5, recs.length)} matches for ${city}:`];
        for (const r of recs.slice(0, 5)) {
          const registerUrl = r.registerUrl || (r.slug ? `${process.env.SITE_URL || ""}/register/${encodeURIComponent(r.slug)}` : "");
          lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);
          if (r.website) lines.push(`  Website: ${r.website}`);
          if (registerUrl) lines.push(`  Register: ${registerUrl}`);
        }
        lines.push("\nReply 'help' for commands.");
        return sendTwimlText(res, lines.join("\n"));
      } catch (e) {
        console.error("TWILIO: recommend call failed:", e && e.message ? e.message : e);
        return sendTwimlText(res, "Search failed — please try again later.");
      }
    }

    // fav add <slug>
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
        console.error("TWILIO: fav add error:", e && e.message ? e.message : e);
        return sendTwimlText(res, "Could not add favourite — try again later.");
      }
    }

    // fallback
    return sendTwimlText(res, "Sorry, I didn't understand. Send 'help' for usage.");
  } catch (err) {
    console.error("TWILIO: webhook handler error:", err && err.stack ? err.stack : err);
    // Best-effort reply
    try {
      return sendTwimlText(res, "Server error; try again later.");
    } catch (e) {
      // if we've already sent headers, just end
      return res.end();
    }
  }
});

export default router;
