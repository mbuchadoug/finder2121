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
      // Use the configured public site URL + the incoming path Twilio called.
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

function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
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

/* POST /webhook  (mount path depends on server.js) */
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

    // verify
    const ok = verifyTwilioRequest(req);
    if (!ok) {
      console.warn("TWILIO: request verification failed");
      return res.status(403).send("Invalid Twilio signature");
    }

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

    // ensure user exists
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

    // greeting/help
    if (!lctext || ["hi", "hello", "hey"].includes(lctext)) {
      const reply =
        "Hi! I'm ZimEduFinder \n\nCommands:\n• find [city] [filters]\n   e.g. 'find harare cambridge boarding primary urban'\n• fav add <slug>\n• help";
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
      const rest = words.slice(2);
      const parsed = parseFilters(rest);

      // persist lastPrefs as structured object
      const lastPrefs = {
        city: String(city),
        curriculum: parsed.curriculum,
        learningEnvironment: parsed.learningEnvironment,
        schoolPhase: parsed.phase,
        type2: parsed.type2,
        facilities: [], // keep placeholder
      };
      try {
        await User.findOneAndUpdate(
          { provider: "whatsapp", providerId },
          { $set: { lastPrefs } },
          { new: true }
        );
        console.log("TWILIO: lastPrefs saved for", providerId, lastPrefs);
      } catch (e) {
        console.error("TWILIO: failed saving lastPrefs:", e && e.message ? e.message : e);
      }

      // call recommend with extended filters
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

        const siteBase = (process.env.SITE_URL || "https://skoolfinder.net").replace(/\/$/, "");
        const lines = [`Top ${Math.min(5, recs.length)} matches for ${city}:`];
        for (const r of recs.slice(0, 5)) {
          lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);
          if (r.curriculum) lines.push(`  Curriculum: ${Array.isArray(r.curriculum) ? r.curriculum.join(", ") : r.curriculum}`);
          if (r.fees) lines.push(`  Fees: ${r.fees}`);
          if (r.website) lines.push(`  Website: ${r.website}`);

          // ONLY show register link for St Eurit (case-insensitive match)
          const name = (r.name || "").toLowerCase();
          const slug = r.slug || "";
          const stEuritMatch = /st[\s-]*eurit/.test(name) || /st[\s-]*eurit/.test(slug.toLowerCase());
          if (stEuritMatch) {
            // preferred: use explicit registerUrl returned by API if it exists and looks like a URL,
            // otherwise build using SITE_URL + /register/<slug>
            let registerUrl = "";
            if (r.registerUrl && typeof r.registerUrl === "string" && /^https?:\/\//i.test(r.registerUrl.trim())) {
              registerUrl = r.registerUrl.trim();
            } else if (slug) {
              // ensure slug is safe in URL
              registerUrl = `${siteBase}/register/${encodeURIComponent(slug)}`;
            } else {
              // fallback to the canonical St Eurit link if you want a hardcoded safety net
              registerUrl = `${siteBase}/register/st-eurit-international-school`;
            }

            // Add register URL on its own line so WhatsApp autolinks it
            lines.push(`  Register: ${registerUrl}`);
          }
        }
        lines.push("\nReply 'help' for commands.");
        return sendTwimlText(res, lines.join("\n"));
      } catch (e) {
        console.error("TWILIO: recommend call failed:", e && (e.message || (e.response && e.response.data)) ? (e.message || JSON.stringify(e.response.data)) : e);
        return sendTwimlText(res, "Search failed — please try again later.");
      }
    }

    // fav add
    if (lctext.startsWith("fav add ") || lctext.startsWith("favorite add ")) {
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

    // fallback
    return sendTwimlText(res, "Sorry, I didn't understand. Send 'help' for usage.");
  } catch (err) {
    console.error("TWILIO: webhook handler error:", err && err.stack ? err.stack : err);
    try {
      return sendTwimlText(res, "Server error; try again later.");
    } catch (e) {
      return res.end();
    }
  }
});

export default router;
