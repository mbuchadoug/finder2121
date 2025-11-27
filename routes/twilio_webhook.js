// routes/twilio_webhook.js
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import User from "../models/user.js";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

const router = Router();

/* --- Helpers --- */
function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function ensureAbsoluteUrl(url) {
  if (!url) return "";
  let u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) {
    u = `https://${u.replace(/^\/+/, "")}`;
  }
  return u;
}

function simpleSanitize(s) {
  if (!s && s !== 0) return "";
  return String(s).trim();
}

/* Accept several forms into a normalized array */
function toArraySafe(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

/* Basic Twilio request verification (can be disabled with DEBUG_TWILIO_SKIP_VERIFY=1) */
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
    // reconstruct full URL Twilio used to call us (important)
    const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
    const host = req.get("host");
    if (!host) {
      console.warn("TWILIO_VERIFY: no host header; cannot verify");
      return false;
    }
    const url = `${proto}://${host}${req.originalUrl}`;
    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) console.warn("TWILIO_VERIFY: signature invalid for", url);
    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY: validateRequest error:", e?.message || e);
    return false;
  }
}

/* Build the payload and call internal recommend API */
async function callRecommend(payload) {
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  if (!site) throw new Error("SITE_URL not configured");
  const url = `${site}/api/recommend`;
  const resp = await axios.post(url, payload, { timeout: 10000 });
  return resp.data;
}

/* Lightweight parser for filters from command text */
function parseFiltersFromWords(words) {
  const curriculum = [];
  let learningEnvironment;
  let schoolPhase;
  const type2 = []; // boarding/day
  const facilities = [];

  for (const w of words) {
    const low = w.toLowerCase();
    // curriculum
    if (/^cambridge$|^caie$|^caie$|^cai$|^caie$/.test(low) || /cambridge|caie/.test(low)) {
      curriculum.push("Cambridge");
      continue;
    }
    if (/zimsec/.test(low)) {
      curriculum.push("ZIMSEC");
      continue;
    }
    if (/ib/.test(low)) {
      curriculum.push("IB");
      continue;
    }

    // learning environment (very broad)
    if (/urban|city|suburban|rural|town|peri-urban/.test(low)) {
      if (/urban|city|town|peri-urban/.test(low)) learningEnvironment = "Urban";
      else if (/suburban/.test(low)) learningEnvironment = "Suburban";
      else if (/rural/.test(low)) learningEnvironment = "Rural";
      continue;
    }

    // school phase
    if (/primary|elementary|prep/.test(low)) {
      schoolPhase = "Primary";
      continue;
    }
    if (/secondary|high|senior/.test(low)) {
      schoolPhase = "Secondary";
      continue;
    }
    if (/pre-?school|nursery|playgroup/.test(low)) {
      schoolPhase = "Preschool";
      continue;
    }

    // boarding/day
    if (/board|boarding/.test(low)) {
      type2.push("Boarding");
      continue;
    }
    if (/day|day-?school/.test(low)) {
      type2.push("Day");
      continue;
    }

    // facilities (simple single-word tags)
    if (/swimming|pool|sports|football|rugby|tennis|computer|it|labs?/.test(low)) {
      facilities.push(low);
      continue;
    }
  }

  // de-duplicate and return
  return {
    curriculum: Array.from(new Set(curriculum)),
    learningEnvironment,
    schoolPhase,
    type2: Array.from(new Set(type2)),
    facilities: Array.from(new Set(facilities)),
  };
}

/* Determine if a school is St-Eurit (loose match by name or slug) */
function isStEuritSchool(r) {
  const nameLower = String(r.name || "").toLowerCase();
  const slugLower = String(r.slug || "").toLowerCase();
  return /st[\s-]*eurit/.test(nameLower) || /st-?eurit/.test(slugLower);
}

/* --- Route --- */
/* POST /twilio/webhook  (mounted under /twilio in server.js) */
router.post("/webhook", async (req, res) => {
  try {
    console.log("TWILIO: incoming webhook", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
    console.log("TWILIO: headers:", {
      host: req.get("host"),
      "x-forwarded-proto": req.get("x-forwarded-proto"),
      "x-twilio-signature": req.header("x-twilio-signature"),
      "content-type": req.get("content-type"),
    });
    console.log("TWILIO: body (raw):", req.body);

    // Verify Twilio signature (or skip in DEBUG)
    const ok = verifyTwilioRequest(req);
    if (!ok) {
      console.warn("TWILIO: request verification failed");
      // return 403 so Twilio knows it's not accepted
      return res.status(403).send("Invalid Twilio signature");
    }

    const params = req.body || {};
    const rawFrom = String(params.From || params.from || "");
    const bodyRaw = String(params.Body || params.body || "").trim();
    const profileName = String(params.ProfileName || params.profileName || "");

    console.log("TWILIO: parsed", { rawFrom, bodyRaw, profileName });

    if (!rawFrom) return sendTwimlText(res, "Missing sender info");

    const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();

    // upsert user and update name
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
    const textLower = text.toLowerCase();

    // Greeting/help
    if (!textLower || ["hi", "hello", "hey"].includes(textLower)) {
      const reply =
        "Hi! I'm ZimEduFinder 🤖\n\nCommands:\n• find [city] — e.g. 'find harare'\n• find [city] boarding cambridge primary\n• fav add <slug>\n• help";
      return sendTwimlText(res, reply);
    }

    if (textLower === "help") {
      const reply =
        "ZimEduFinder Help:\n• find [city] [filters]\nFilters: cambridge, zimsec, ib, boarding, day, primary, secondary, urban, rural\nExample: 'find harare cambridge boarding primary'";
      return sendTwimlText(res, reply);
    }

    // favourite add: "fav add <slug>"
    if (textLower.startsWith("fav add ") || textLower.startsWith("favorite add ")) {
      const slug = text.split(/\s+/).slice(2).join(" ").trim();
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

    // find command -> parse filters and call recommend
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length && words[0].toLowerCase() === "find") {
      const city = words[1] || "";
      const remainder = words.slice(city ? 2 : 1); // words after city
      // parse filters from remainder and also include any tokens in the entire command
      const filterTokens = parseFiltersFromWords(words.slice(1));
      const payload = {
        city: simpleSanitize(city) || undefined,
        learningEnvironment: filterTokens.learningEnvironment || undefined,
        curriculum: filterTokens.curriculum || [],
        schoolPhase: filterTokens.schoolPhase || undefined,
        type2: filterTokens.type2 || [],
        facilities: filterTokens.facilities || [],
      };

      // Persist lastPrefs to user (safe shape)
      try {
        user.lastPrefs = {
          city: payload.city || undefined,
          curriculum: payload.curriculum || [],
          learningEnvironment: payload.learningEnvironment || undefined,
          schoolPhase: payload.schoolPhase || undefined,
          type2: payload.type2 || [],
          facilities: payload.facilities || [],
        };
        await user.save();
      } catch (e) {
        console.warn("TWILIO: saving lastPrefs failed:", e && e.message ? e.message : e);
      }

      // Call recommend
      let data;
      try {
        data = await callRecommend({
          city: payload.city,
          learningEnvironment: payload.learningEnvironment,
          curriculum: payload.curriculum,
          type: [], // kept for backward compatibility
          type2: payload.type2,
          facilities: payload.facilities,
          schoolPhase: payload.schoolPhase,
        });
      } catch (e) {
        console.error("TWILIO: recommend call failed:", e && e.message ? e.message : e);
        return sendTwimlText(res, "Search failed — please try again later.");
      }

      const recs = (data && data.recommendations) || [];
      if (!recs.length) {
        return sendTwimlText(res, `No matches found for "${payload.city || 'your query'}". Try 'find harare' or 'help'.`);
      }

      // Build reply lines (top 5)
      const lines = [`Top ${Math.min(5, recs.length)} matches for ${payload.city || words.slice(1).join(" ")}:`];
      for (const r of recs.slice(0, 5)) {
        // Basic info
        lines.push(`\n• ${r.name || "Unknown"}${r.city ? " — " + r.city : ""}`);

        // curriculum if present in record or parsed
        if (r.curriculum && (Array.isArray(r.curriculum) && r.curriculum.length)) {
          lines.push(`  Curriculum: ${Array.isArray(r.curriculum) ? r.curriculum.join(", ") : r.curriculum}`);
        }

        if (r.phase || r.schoolPhase) {
          const ph = r.phase || r.schoolPhase;
          lines.push(`  Phase: ${ph}`);
        }

        // website (ensure scheme)
        if (r.website) {
          const website = ensureAbsoluteUrl(r.website);
          lines.push(`  Website: ${website}`);
        }

        // Determine register URL (prefer r.registerUrl, fallback to slug on your site)
        let registerUrl = "";
        if (r.registerUrl) registerUrl = simpleSanitize(r.registerUrl);
        if (!registerUrl && r.slug) {
          const base = (process.env.SITE_URL || "").replace(/\/$/, "");
          if (base) registerUrl = `${base}/register/${encodeURIComponent(String(r.slug))}`;
        }
        registerUrl = ensureAbsoluteUrl(registerUrl);

        // Only show Register link for St Eurit (loose match) and when URL looks valid
        if (isStEuritSchool(r) && registerUrl) {
          lines.push(`  Register: ${registerUrl}`);
        }
      }

      // Send aggregated TwiML reply
      const finalMsg = lines.join("\n");
      console.log("TWILIO: reply ->", finalMsg);
      return sendTwimlText(res, finalMsg);
    }

    // Fallback/unrecognised
    return sendTwimlText(res, "Sorry, I didn't understand. Send 'help' for usage.");
  } catch (err) {
    console.error("TWILIO: webhook handler error:", err && err.stack ? err.stack : err);
    // safest fallback: TwiML error message
    try {
      return sendTwimlText(res, "Server error; try again later.");
    } catch (e) {
      // if even that fails, just end response
      return res.status(500).end();
    }
  }
});

export default router;
