// routes/twilio_webhook.js  (synchronous TwiML responder, sends media for St Eurit)
import express from "express";
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------- helpers ---------- */
function sendTwimlText(res, text) {
  try {
    const twiml = new MessagingResponse();
    twiml.message(text || "");
    res.set("Content-Type", "text/xml");
    return res.send(twiml.toString());
  } catch (e) {
    res.set("Content-Type", "text/plain");
    return res.send(String(text || ""));
  }
}

function sendTwimlWithMedia(res, text, mediaUrls = []) {
  try {
    const twiml = new MessagingResponse();
    const msg = twiml.message();
    if (text) msg.body(text);
    for (const m of (mediaUrls || [])) {
      if (m) msg.media(m);
    }
    res.set("Content-Type", "text/xml");
    return res.send(twiml.toString());
  } catch (e) {
    console.error("sendTwimlWithMedia error:", e);
    return sendTwimlText(res, text || "");
  }
}

function toArraySafe(v) {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

/**
 * Normalize various incoming identifiers to a canonical no-space form.
 * e.g. "+263 789 901 058" -> "+263789901058"
 */
function normalizePhone(s = "") {
  return String(s || "")
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d\+]/g, "") // keep plus and digits only
    .replace(/\s+/g, "")
    .trim();
}

function verifyTwilioRequest(req) {
  // keep existing behaviour: allow skipping verification during debugging/dev
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
    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) console.warn("TWILIO_VERIFY: signature invalid for", url, "signature:", signature);
    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY: error:", e?.message || e);
    return false;
  }
}

/* ---------- webhook ---------- */
router.post("/webhook", async (req, res) => {
  console.log("TWILIO: webhook hit ->", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
  console.log("TWILIO: debug env:", {
    SITE_URL: process.env.SITE_URL ? "[set]" : "[missing]",
    DEBUG_TWILIO_SKIP_VERIFY: process.env.DEBUG_TWILIO_SKIP_VERIFY || "[not set]",
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? "[set]" : "[missing]",
  });

  try {
    console.log("TWILIO: body (raw):", JSON.stringify(req.body));
  } catch (e) {
    console.log("TWILIO: body (raw) - keys:", Object.keys(req.body || {}));
  }

  // Verify Twilio signature
  const ok = verifyTwilioRequest(req);
  if (!ok) {
    console.warn("TWILIO: request verification failed -> replying 403");
    res.status(403);
    return sendTwimlText(res, "Invalid Twilio signature");
  }

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
    const normProvider = normalizePhone(providerId);

    // Admin numbers (normalize them similarly). Accept either spaced or plain formats.
    const adminNumbersRaw = ["+263 789 901 058", "+263 774 716 074"];
    const adminNumbers = adminNumbersRaw.map(normalizePhone);

    if (adminNumbers.includes(normProvider)) {
      console.log("TWILIO: admin number detected ->", providerId);
      return sendTwimlText(res, "hi admin");
    }

    // Upsert / create user record and keep name updated
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

    // Greetings/help
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

    // fav add
    if (lctext.startsWith("fav add ") || lctext.startsWith("favorite add ")) {
      const slug = bodyRaw.split(/\s+/).slice(2).join(" ").trim();
      if (!slug) return sendTwimlText(res, "Please provide the school slug, e.g. 'fav add st-eurit-international-school'");

      try {
        const site = (process.env.SITE_URL || "").replace(/\/$/, "");
        const baseForApi = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
        const resp2 = await axios.get(`${baseForApi}/api/school-by-slug/${encodeURIComponent(slug)}`, { timeout: 5000 }).catch(() => null);
        const school = resp2 && resp2.data && resp2.data.school;
        if (!school) return sendTwimlText(res, `School not found for slug "${slug}"`);
        await User.findOneAndUpdate({ provider: "whatsapp", providerId }, { $addToSet: { favourites: school._id } }, { upsert: true });
        return sendTwimlText(res, `Added "${school.name}" to your favourites.`);
      } catch (e) {
        console.error("TWILIO: fav add error:", e && e.message ? e.message : e);
        return sendTwimlText(res, "Could not add favourite — try again later.");
      }
    }

    // find command -> synchronous recommend + TwiML reply (includes St Eurit media)
    const words = lctext.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      const city = words[1] || "Harare";
      const wantsBoarding = words.some((w) => /board|boarding/.test(w));
      const type2 = wantsBoarding ? ["Boarding"] : [];
      const curriculum = words.filter((w) => /cambridge|caie|zimsec|ib/.test(w));

      const lastPrefs = {
        city: String(city),
        curriculum: Array.isArray(curriculum) ? curriculum.map(String) : toArraySafe(curriculum),
        learningEnvironment: undefined,
        schoolPhase: undefined,
        type2: Array.isArray(type2) ? type2.map(String) : toArraySafe(type2),
        facilities: [],
      };

      // save lastPrefs (defensive)
      try {
        console.log("TWILIO: saving lastPrefs for", providerId, JSON.stringify(lastPrefs).slice(0, 1000));
        await User.findOneAndUpdate({ provider: "whatsapp", providerId }, { $set: { lastPrefs } }, { new: true, upsert: true });
      } catch (e) {
        console.error("TWILIO: failed saving lastPrefs:", e && (e.stack || e.message) ? (e.stack || e.message) : e);
      }

      // build recommend endpoint url
      const site = (process.env.SITE_URL || "").replace(/\/$/, "");
      const baseForApi = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
      const recommendUrl = `${baseForApi}/api/recommend`;

      // call recommend
      let resp;
      try {
        resp = await axios.post(
          recommendUrl,
          {
            city: lastPrefs.city,
            curriculum: lastPrefs.curriculum,
            learningEnvironment: lastPrefs.learningEnvironment,
            schoolPhase: lastPrefs.schoolPhase,
            type2: lastPrefs.type2,
            facilities: lastPrefs.facilities,
          },
          { timeout: 10000 }
        );
      } catch (err) {
        console.error("TWILIO: recommend axios error:", {
          message: err?.message,
          status: err?.response?.status,
          data: err?.response?.data,
        });
        return sendTwimlText(res, "Search failed — please try again later.");
      }

      const recs = (resp.data && resp.data.recommendations) || [];
      if (!recs.length) {
        return sendTwimlText(res, `No matches found for "${city}" with those filters. Try fewer filters or 'help'.`);
      }

      const lines = [`Top ${Math.min(5, recs.length)} matches for ${city}:`];
      let foundStEurit = false;

      for (const r of recs.slice(0, 5)) {
        lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);
        if (r.curriculum) lines.push(`  Curriculum: ${Array.isArray(r.curriculum) ? r.curriculum.join(", ") : r.curriculum}`);
        if (r.fees) lines.push(`  Fees: ${r.fees}`);
        if (r.website) lines.push(`  Website: ${r.website}`);

        const nameLower = (r.name || "").toLowerCase();
        const slugLower = (r.slug || "").toLowerCase();
        if (/st[\s-]*eurit/.test(nameLower) || /st-eurit/.test(slugLower)) {
          foundStEurit = true;
          const registerUrl = `${baseForApi.replace(/\/$/, "")}/register/st-eurit-international-school`;
          lines.push(`  Register: ${registerUrl}`);
        }
      }

      lines.push("\nReply 'help' for commands.");

      // If St Eurit found, include images + PDFs (served from /docs)
      if (foundStEurit) {
        const baseForMedia = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
        const mediaUrls = [
          `${baseForMedia}/docs/st-eurit.jpg`,
          `${baseForMedia}/docs/st-eurit-pic2.jpg`,
          `${baseForMedia}/docs/st-eurit-registration.pdf`,
          `${baseForMedia}/docs/st-eurit-profile.pdf`,
          `${baseForMedia}/docs/st-eurit-enrollment-requirements.pdf`,
        ];
        console.log("TWILIO: sending St Eurit media to", providerId, { mediaUrls });
        return sendTwimlWithMedia(res, lines.join("\n"), mediaUrls);
      }

      // otherwise send textual list
      return sendTwimlText(res, lines.join("\n"));
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
