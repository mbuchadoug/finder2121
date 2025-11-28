// routes/twilio_webhook.js
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import User from "../models/user.js";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

const router = Router();

function toArraySafe(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

/**
 * Parse extended filters from words.
 * - curriculum: cambridge, caie, zimsec, ib
 * - learningEnvironment: urban, suburban, rural
 * - phase: preschool, nursery, primary, secondary, high
 * - boarding/day: boarding or day
 */
function parseFilters(words) {
  const curriculum = [];
  const type2 = []; // boarding/day
  let learningEnvironment;
  let phase;

  for (const w of words) {
    const word = w.toLowerCase();
    // curriculum
    if (/cambridge|caie/.test(word)) curriculum.push("Cambridge");
    if (/zimsec/.test(word)) curriculum.push("ZIMSEC");
    if (/^ib$/.test(word)) curriculum.push("IB");

    // boarding/day
    if (/board|boarding/.test(word)) type2.push("Boarding");
    if (/day|dayonly|day-school|dayschool/.test(word)) type2.push("Day");

    // learning environment
    if (/urban|city|town/.test(word)) learningEnvironment = "Urban";
    if (/suburb|suburban/.test(word)) learningEnvironment = "Suburban";
    if (/rural|village/.test(word)) learningEnvironment = "Rural";

    // phase
    if (/presch|nurser|playgroup/.test(word)) phase = "Preschool";
    if (/primary|elementary/.test(word)) phase = "Primary";
    if (/secondary|high|upper/.test(word)) phase = "Secondary";
  }

  return {
    curriculum: [...new Set(curriculum)],
    type2: [...new Set(type2)],
    learningEnvironment,
    phase,
  };
}

/**
 * Verify Twilio request.
 * Uses SITE_URL if configured (recommended), otherwise reconstructs from x-forwarded-proto / req.protocol + host.
 * This version logs the computed URL & signature to help debug "signature invalid" issues.
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

    // logging to help debug signature mismatch issues
    console.log("TWILIO_VERIFY: computed verification URL:", url);
    console.log("TWILIO_VERIFY: x-twilio-signature:", signature);
    console.log("TWILIO_VERIFY: TWILIO_AUTH_TOKEN set?", !!process.env.TWILIO_AUTH_TOKEN);

    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) console.warn("TWILIO_VERIFY: signature invalid for", url, "signature:", signature);
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
// -- debug handler (temporary) --
router.post("/webhook", express.urlencoded({ extended: true }), async (req, res) => {
  try {
    console.log("DEBUG: webhook entry point");
    console.log("DEBUG: full req.method, url:", req.method, req.originalUrl);
    console.log("DEBUG: headers:", JSON.stringify(req.headers, null, 2));
    // body might already be parsed by global express.urlencoded, but ensure it:
    console.log("DEBUG: raw body object type:", typeof req.body);
    console.log("DEBUG: body keys:", Object.keys(req.body || {}));
    console.log("DEBUG: body content:", JSON.stringify(req.body || {}, null, 2));

    // Short-circuit respond so Twilio sees success
    res.set("Content-Type", "text/plain");
    res.status(200).send("DEBUG OK");

    // Continue async processing (won't block returning the response)
    setImmediate(async () => {
      try {
        // Show compute of verification URL if you later re-enable verification
        const signature = req.header("x-twilio-signature");
        const configuredSite = (process.env.SITE_URL || "").replace(/\/$/, "");
        let url;
        if (configuredSite) url = `${configuredSite}${req.originalUrl}`;
        else {
          const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
          const host = req.get("host");
          url = host ? `${proto}://${host}${req.originalUrl}` : "(no host header)";
        }
        console.log("DEBUG (async): computed verification url:", url);
        console.log("DEBUG (async): x-twilio-signature:", signature);
        // Do any other processing here for deeper testing (DB saves etc)
      } catch (innerErr) {
        console.error("DEBUG (async) error:", innerErr && innerErr.stack ? innerErr.stack : innerErr);
      }
    });

  } catch (err) {
    console.error("DEBUG: outer handler error:", err && err.stack ? err.stack : err);
    // Try to always return something
    try {
      res.status(500).send("DEBUG ERROR");
    } catch (e) {
      // nothing more we can do
    }
  }
});


export default router;
