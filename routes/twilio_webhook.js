// routes/twilio_webhook.js
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import User from "../models/user.js";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

const router = Router();

function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function toArraySafe(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

// prefer SITE_URL if present (most reliable), otherwise use forwarded proto or req.protocol + host
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

    // If the deployed SITE_URL is set (and reachable by Twilio), use that as the base.
    // This avoids proxy-related mismatches. Ensure SITE_URL includes protocol (https://).
    const configuredSite = (process.env.SITE_URL || "").replace(/\/$/, "");
    let url;
    if (configuredSite) {
      url = `${configuredSite}${req.originalUrl}`;
    } else {
      // fallback: reconstruct from forwarded proto or req.protocol
      const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
      const host = req.get("host");
      if (!host) {
        console.warn("TWILIO_VERIFY: no host header; cannot verify");
        return false;
      }
      url = `${proto}://${host}${req.originalUrl}`;
    }

    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) console.warn("TWILIO_VERIFY: signature invalid for", url, "signature:", signature);
    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY: validateRequest error:", e?.message || e);
    return false;
  }
}

/**
 * NEW: quick-ack endpoint
 * - Immediately responds with TwiML "Received" so Twilio doesn't timeout.
 * - Continues to process the message in a microtask (setImmediate).
 * - Very verbose logging so you can inspect pm2/nodemon logs.
 */
router.post("/webhook", (req, res) => {
  try {
    // Log raw info up front
    console.log("TWILIO: incoming webhook", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
    console.log("TWILIO: headers:", {
      host: req.get("host"),
      "x-forwarded-proto": req.get("x-forwarded-proto"),
      "x-twilio-signature": req.header("x-twilio-signature"),
      "content-type": req.get("content-type"),
    });
    console.log("TWILIO: body (raw):", req.body);

    // Immediately ACK Twilio so we won't be retried for timeouts
    sendTwimlText(res, "Received"); // quick response

    // Process in next tick so response is returned quickly
    setImmediate(async () => {
      try {
        // verify request (will log reasons if it fails)
        const ok = verifyTwilioRequest(req);
        if (!ok) {
          console.warn("TWILIO: request verification failed");
          return;
        }
        // parse fields
        const params = req.body || {};
        const rawFrom = String(params.From || params.from || "");
        const bodyRaw = String(params.Body || params.body || "").trim();
        const profileName = String(params.ProfileName || params.profileName || "");
        console.log("TWILIO: parsed", { rawFrom, bodyRaw, profileName });

        if (!rawFrom) {
          console.warn("TWILIO: missing From, abort processing");
          return;
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

        // simple commands
        if (!text || ["hi", "hello", "hey"].includes(text)) {
          console.log("TWILIO: greeting received, no reply here (already ACKed).");
          return;
        }
        if (text === "help") {
          console.log("TWILIO: help requested");
          return;
        }

        // handle "find"
        const words = text.split(/\s+/).filter(Boolean);
        if (words[0] === "find") {
          const city = words[1] || "Harare";
          const wantsBoarding = words.some((w) => /board|boarding/.test(w));
          const type2 = wantsBoarding ? ["Boarding"] : [];
          const curriculum = words.filter((w) => /cambridge|caie|zimsec|ib/.test(w));
          const facilities = [];

          const prefs = {
            city: String(city),
            curriculum: toArraySafe(curriculum),
            type: [],
            type2: toArraySafe(type2),
            facilities: toArraySafe(facilities),
          };

          // safe update to lastPrefs
          try {
            await User.findOneAndUpdate(
              { provider: "whatsapp", providerId },
              { $set: { lastPrefs: prefs } },
              { new: true }
            );
            console.log("TWILIO: lastPrefs saved for", providerId);
          } catch (e) {
            console.error("TWILIO: failed saving lastPrefs:", e && e.message ? e.message : e);
          }

          // call recommend
          try {
            const site = (process.env.SITE_URL || "").replace(/\/$/, "");
            if (!site) throw new Error("SITE_URL not configured");
            const resp = await axios.post(`${site}/api/recommend`, {
              city: prefs.city,
              learningEnvironment: undefined,
              curriculum: prefs.curriculum,
              type: prefs.type,
              type2: prefs.type2,
              facilities: prefs.facilities,
            }, { timeout: 8000 });
            console.log("TWILIO: recommend returned", (resp.data && resp.data.recommendations || []).length, "results");
          } catch (e) {
            console.error("TWILIO: recommend call failed:", e && e.message ? e.message : e);
          }
          return;
        }

        // fav add
        if (text.startsWith("fav add ") || text.startsWith("favorite add ")) {
          const slug = bodyRaw.split(/\s+/).slice(2).join(" ").trim();
          if (!slug) {
            console.warn("TWILIO: fav add missing slug");
            return;
          }
          try {
            const site = (process.env.SITE_URL || "").replace(/\/$/, "");
            const resp = await axios.get(`${site}/api/school-by-slug/${encodeURIComponent(slug)}`, { timeout: 5000 }).catch(() => null);
            const school = resp && resp.data && resp.data.school;
            if (!school) {
              console.warn("TWILIO: fav add - school not found for slug", slug);
              return;
            }
            await User.findOneAndUpdate({ provider: "whatsapp", providerId }, { $addToSet: { favourites: school._id } }, { upsert: true });
            console.log("TWILIO: added favourite", school._id, "for", providerId);
          } catch (e) {
            console.error("TWILIO: fav add error:", e && e.message ? e.message : e);
          }
          return;
        }

        console.log("TWILIO: unrecognised message, done processing.");
      } catch (procErr) {
        console.error("TWILIO: processing error (inner):", procErr && procErr.stack ? procErr.stack : procErr);
      }
    });
  } catch (err) {
    console.error("TWILIO: outer webhook handler error:", err && err.stack ? err.stack : err);
    // We already sent an ACK; nothing more to do.
  }
});

export default router;
