// routes/twilio_webhook.js
import { Router } from "express";
import crypto from "crypto";
import User from "../models/user.js";
import School from "../models/school.js";
import { xml } from "xmlbuilder2"; // optional; we'll use string building for TwiML
import axios from "axios";
import twilio from "twilio";

const router = Router();

/**
 * Helper: verify Twilio signature
 * Uses Twilio helper validateRequest
 */
function verifyTwilioRequest(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn("TWILIO_AUTH_TOKEN not set — skipping signature verification (dev only)");
    return true;
  }
  // twilio.validateRequest(authToken, signature, url, params)
  // signature header:
  const signature = req.header("x-twilio-signature");
  const url = (process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, "") : "") + req.originalUrl;
  // req.body must be raw-parsed for validateRequest; express.json/urlencoded is fine as we pass params object
  const params = Object.assign({}, req.body);
  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch (e) {
    console.warn("twilio.validateRequest error:", e?.message || e);
    return false;
  }
}

/**
 * Small helper: send TwiML response (text)
 */
function twimlMessage(text) {
  // TwiML format
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(text)}</Message></Response>`;
}
function escapeXml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");
}

/**
 * Basic simple search helper that mirrors a smaller subset of your /api/recommend logic.
 * We'll do a light search: by city/curriculum/type + facilities.
 * Returns an array of { name, slug, city, website } (max limit)
 */
async function simpleFindSchools({ city = "Harare", curriculum = [], type = [], type2 = [], facilities = [] } = {}) {
  const and = [];
  if (city) and.push({ city: { $regex: new RegExp(city.replace(/\s+/g, "\\s+"), "i") } });

  if (Array.isArray(curriculum) && curriculum.length) {
    // case-insensitive any-of in curriculum_list
    and.push({ curriculum_list: { $in: curriculum.map((c) => new RegExp(c, "i")) } });
  }
  if (Array.isArray(type) && type.length) {
    and.push({ type: { $in: type.map((t) => new RegExp(t, "i")) } });
  }
  if (Array.isArray(type2) && type2.length) {
    // e.g. boarding or day
    const wantBoarding = type2.some((t) => /board/i.test(t));
    if (wantBoarding) and.push({ $or: [{ "facilities.boarding": true }, { type2: { $in: type2.map((t) => new RegExp(t, "i")) } }] });
    else and.push({ type2: { $in: type2.map((t) => new RegExp(t, "i")) } });
  }
  if (Array.isArray(facilities) && facilities.length) {
    for (const f of facilities) {
      and.push({ [`facilities.${f}`]: true });
    }
  }

  const filter = and.length ? { $and: and } : {};
  const docs = await School.find(filter).select("name slug city website").sort({ tier: 1, name: 1 }).limit(5).lean();
  return docs.map((d) => ({ name: d.name, slug: d.slug, city: d.city, website: d.website }));
}

/**
 * Primary webhook route: POST /webhooks/twilio
 */
router.post("/webhooks/twilio", async (req, res) => {
  try {
    // 1) verify Twilio signature (recommended)
    if (!verifyTwilioRequest(req)) {
      // If verification fails, respond 403
      console.warn("Twilio signature verification failed");
      return res.status(403).send("invalid signature");
    }

    const params = req.body || {};
    // Twilio sends From like "whatsapp:+263784277776" and Body text
    const from = params.From || params.from || "";
    const body = (params.Body || params.Body || "").trim();
    const profileName = params.ProfileName || params.ProfileName || null; // sometimes provided
    // extract number canonical (remove whatsapp:)
    const providerId = from.replace(/^whatsapp:/i, "").trim();

    // Upsert user record — store provider='whatsapp', providerId=phone
    let user = await User.findOne({ provider: "whatsapp", providerId });
    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        name: profileName || undefined,
        role: "user",
        // email etc not known
      });
    } else {
      // update name if we got profileName and it's different
      if (profileName && user.name !== profileName) {
        user.name = profileName;
        await user.save();
      }
    }

    // Parse the incoming message. We'll support:
    // "find [city]"  -> quick search
    // "help" -> show usage
    // "fav ADD <slug>" -> add favourite (optional)
    // If message contains commas, we'll try as key:value pairs (advanced)
    const text = (body || "").toLowerCase();

    if (!text || text === "hi" || text === "hello" || text === "hey") {
      const reply =
        "Hi! I'm ZimEduFinder 🤖\n\nReply with:\n• find [city] — e.g. 'find harare' \n• find [city] boarding — e.g. 'find gweru boarding'\n• help — show this message\n\nYou can also send your preferred curriculum or facilities, e.g. 'find harare cambridge swimmingPool'.";
      return res.type("application/xml").send(twimlMessage(reply));
    }

    if (text === "help") {
      const reply =
        "ZimEduFinder help:\n• find [city] [optional filters]\nExamples:\n• find harare\n• find harare boarding\n• find harare cambridge swimmingPool\nWe will reply with up to 5 matching schools and a short link to register.";
      return res.type("application/xml").send(twimlMessage(reply));
    }

    // quick parse: split words and look for known keywords like 'boarding' or curriculum
    const words = text.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      // default values
      const city = words[1] || "Harare";
      const rest = words.slice(2); // possible filters
      const type2 = rest.some((w) => /board|boarding/.test(w)) ? ["Boarding"] : [];
      const curricula = rest.filter((w) => /cambridge|caie|zimsec|ib/.test(w));
      // facilities: match any word that matches a facility key (simple)
      const facilityCandidates = [
        "scienceLabs",
        "computerLab",
        "library",
        "makerSpaceSteamLab",
        "examCentreCambridge",
        "examCentreZimsec",
        "artStudio",
        "musicRoom",
        "dramaTheatre",
        "swimmingPool",
        "athleticsTrack",
        "rugbyField",
        "hockeyField",
        "tennisCourts",
        "basketballCourt",
        "netballCourt",
        "footballPitch",
        "cricketField",
        "counseling",
        "learningSupportSEN",
        "schoolClinicNurse",
        "cafeteria",
        "aftercare",
        "boarding",
        "transportBuses",
        "wifiCampus",
        "cctvSecurity",
        "powerBackup",
      ];
      const facilities = [];
      for (const r of rest) {
        for (const f of facilityCandidates) {
          if (f.toLowerCase().includes(r) || r.includes(f.toLowerCase())) {
            facilities.push(f);
            break;
          }
        }
      }

      // fetch results (using internal helper)
      const results = await simpleFindSchools({
        city,
        curriculum: curricula,
        type: [],
        type2,
        facilities,
      });

      if (!results.length) {
        const reply = `No results found for "${city}" with your filters. Try broader search like 'find ${city}' or 'help'`;
        return res.type("application/xml").send(twimlMessage(reply));
      }

      // Build reply text
      const lines = [];
      lines.push(`Top ${Math.min(5, results.length)} matches for ${city}:`);
      for (const r of results.slice(0, 5)) {
        const registerUrl = r.slug ? `${process.env.SITE_URL || ""}/register/${encodeURIComponent(r.slug)}` : "";
        lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);
        if (r.website) lines.push(`  Website: ${r.website}`);
        if (registerUrl) lines.push(`  Register: ${registerUrl}`);
      }
      lines.push("\nReply 'help' for usage or 'find [city]' to search again.");
      return res.type("application/xml").send(twimlMessage(lines.join("\n")));
    }

    // fav and other commands
    if (text.startsWith("fav add ") || text.startsWith("favorite add ") || text.startsWith("f add ")) {
      const slug = body.split(/\s+/).slice(2).join(" ").trim();
      if (!slug) return res.type("application/xml").send(twimlMessage("Please provide the school slug to favourite, e.g. 'fav add st-eurit-international-school'"));
      // find school by slug
      const school = await School.findOne({ slug }).select("_id name slug").lean();
      if (!school) return res.type("application/xml").send(twimlMessage(`School not found for slug "${slug}"`));
      // add to user's favourites
      await User.findOneAndUpdate(
        { provider: "whatsapp", providerId },
        { $addToSet: { favourites: school._id } },
        { upsert: true }
      );
      return res.type("application/xml").send(twimlMessage(`Added "${school.name}" to your favourites.`));
    }

    // default fallback
    const fallback = "Sorry, I didn't understand. Send 'help' for usage or 'find [city]'.";
    return res.type("application/xml").send(twimlMessage(fallback));
  } catch (err) {
    console.error("twilio webhook error:", err);
    // Twilio expects XML or 200; send fallback
    return res.type("application/xml").send(twimlMessage("Server error; please try again later."));
  }
});

export default router;
