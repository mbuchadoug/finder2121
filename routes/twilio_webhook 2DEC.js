import express from "express";
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

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

function verifyTwilioRequest(req) {
  if (process.env.DEBUG_TWILIO_SKIP_VERIFY === "1") return true;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return true;
  try {
    const signature = req.header("x-twilio-signature");
    const configuredSite = (process.env.SITE_URL || "").replace(/\/$/, "");
    let url;
    if (configuredSite) {
      url = `${configuredSite}${req.originalUrl}`;
    } else {
      const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
      const host = req.get("host");
      url = `${proto}://${host}${req.originalUrl}`;
    }
    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) console.warn("TWILIO_VERIFY: signature invalid for", url);
    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY: error:", e?.message || e);
    return false;
  }
}

router.post("/webhook", async (req, res) => {
  console.log("TWILIO: webhook hit ->", { path: req.path });
  const ok = verifyTwilioRequest(req);
  if (!ok) {
    res.status(403);
    return sendTwimlText(res, "Invalid Twilio signature");
  }

  try {
    const params = req.body || {};
    const rawFrom = String(params.From || "");
    const bodyRaw = String(params.Body || "").trim();
    const profileName = String(params.ProfileName || "");
    if (!rawFrom) return sendTwimlText(res, "Missing sender info");
    const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();

    let user = await User.findOne({ provider: "whatsapp", providerId });
    if (!user) {
      user = await User.create({ provider: "whatsapp", providerId, name: profileName || undefined, role: "user" });
    } else if (profileName && user.name !== profileName) {
      user.name = profileName;
      await user.save();
    }

    const text = (bodyRaw || "").trim();
    const lctext = text.toLowerCase();

    if (!lctext || ["hi", "hello", "hey"].includes(lctext)) {
      const reply = "Hi! I'm ZimEduFinder 🤖\nCommands:\n• find [city] [filters]\n• help\nExample: find harare cambridge boarding";
      return sendTwimlText(res, reply);
    }
    if (lctext === "help") {
      return sendTwimlText(res, "Help: find [city] [filters]. Example: find harare cambridge boarding primary");
    }

    // simple "find" parsing
    const words = lctext.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      const city = words[1] || "Harare";
      const curriculum = words.filter((w) => /cambridge|caie|zimsec|ib/.test(w));
      const type2 = words.some((w) => /board|boarding/.test(w)) ? ["Boarding"] : [];

      const lastPrefs = {
        city: String(city),
        curriculum: curriculum,
        learningEnvironment: undefined,
        schoolPhase: undefined,
        type2,
        facilities: [],
      };
      try {
        await User.findOneAndUpdate({ provider: "whatsapp", providerId }, { $set: { lastPrefs } }, { new: true, upsert: true });
      } catch (e) {
        console.error("TWILIO: save lastPrefs failed:", e);
      }

      try {
        const site = (process.env.SITE_URL || "").replace(/\/$/, "");
        if (!site) throw new Error("SITE_URL not configured");
        const resp = await axios.post(`${site}/api/recommend`, {
          city: lastPrefs.city,
          curriculum: lastPrefs.curriculum,
          learningEnvironment: lastPrefs.learningEnvironment,
          type2: lastPrefs.type2,
          facilities: lastPrefs.facilities,
        }, { timeout: 10000 });

        const recs = (resp.data && resp.data.recommendations) || [];
        const pinnedSchool = (resp.data && resp.data.pinnedSchool) || null;

        if (!recs.length && !pinnedSchool) {
          return sendTwimlText(res, `No matches for "${city}". Try fewer filters or 'help'.`);
        }

        // Build a concise WhatsApp reply (text) — include pinned school downloads + image only for St-Eurit
        const lines = [];
        if (pinnedSchool) {
          lines.push(`👉 Featured: ${pinnedSchool.name}`);
          if (pinnedSchool.heroImage) lines.push(`Image: ${site}${pinnedSchool.heroImage}`);
          if (pinnedSchool.registerUrl) lines.push(`Register (online): ${site}${pinnedSchool.registerUrl}`);
          // include download links (only shown for pinned school)
          if (pinnedSchool.downloads) {
            if (pinnedSchool.downloads.registration) lines.push(`Registration form: ${site}${pinnedSchool.downloads.registration}`);
            if (pinnedSchool.downloads.profile) lines.push(`School profile: ${site}${pinnedSchool.downloads.profile}`);
            if (pinnedSchool.downloads.enrollment) lines.push(`Enrollment requirements: ${site}${pinnedSchool.downloads.enrollment}`);
          }
          lines.push(""); // blank line
        }

        lines.push(`Top ${Math.min(5, recs.length)} matches for ${lastPrefs.city}:`);
        for (const r of recs.slice(0, 5)) {
          lines.push(`• ${r.name}${r.city ? " — " + r.city : ""}`);
          if (r.curriculum && r.curriculum.length) lines.push(`  Curriculum: ${Array.isArray(r.curriculum) ? r.curriculum.join(", ") : r.curriculum}`);
          if (r.website) lines.push(`  Website: ${r.website}`);
          // special: if this result is St Eurit (slug or name) include the registration/profile/enrollment links + hero image
          const name = (r.name || "").toLowerCase();
          const slug = (r.slug || "").toLowerCase();
          if (/st[\s-]*eurit/.test(name) || /st-eurit/.test(slug)) {
            lines.push(`  Register: ${site}${r.registerUrl || `/register/${r.slug}`}`);
            lines.push(`  Profile: ${site}/download/st-eurit-profile`);
            lines.push(`  RegForm: ${site}/download/st-eurit-registration`);
            lines.push(`  Enrollment: ${site}/download/st-eurit-enrollment`);
            // include hero image path if present
            if (r.heroImage) lines.push(`  Image: ${site}${r.heroImage}`);
            else lines.push(`  Image: ${site}/docs/st-eurit.jpg`);
          }
        }
        lines.push("\nReply 'help' for commands.");
        return sendTwimlText(res, lines.join("\n"));
      } catch (e) {
        console.error("TWILIO: recommend call failed:", e && (e.message || e.response && JSON.stringify(e.response.data)) ? (e.message || JSON.stringify(e.response && e.response.data)) : e);
        return sendTwimlText(res, "Search failed — please try again later.");
      }
    }

    // fav add handler (unchanged)
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

    return sendTwimlText(res, "Sorry, I didn't understand. Send 'help' for usage.");
  } catch (err) {
    console.error("TWILIO: webhook handler error:", err);
    try {
      return sendTwimlText(res, "Server error; try again later.");
    } catch (e) {
      return res.status(500).end();
    }
  }
});

export default router;
