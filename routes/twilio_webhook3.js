// routes/twilio_webhook.js
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import User from "../models/userCopy.js"; // your existing mongoose model
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

const router = Router();

/* ---------------- helpers ---------------- */

function quickTwimlAck(res, text = "Received") {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function buildRegisterUrlForSchool(school) {
  // Only show registration link for St-Eurit (adjust slug match to your slug)
  if (!school) return null;
  // Example slug check - change to your actual slug value
  const allowedSlug = "st-eurit-international-school"; // <-- change if different
  if (String(school.slug || "").toLowerCase() === allowedSlug.toLowerCase()) {
    return `${process.env.SITE_URL?.replace(/\/$/, "") || ""}/register/${encodeURIComponent(school.slug || school._id)}`;
  }
  return null;
}

function parseFiltersFromText(text) {
  const words = text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  const out = {
    command: words[0] || "",
    city: words[1] || "",
    curriculum: [],
    learningEnvironment: undefined,
    schoolPhase: undefined,
    type2: [], // Day/Boarding
    facilities: [],
  };

  for (const w of words.slice(2)) {
    const lw = w.toLowerCase();
    if (/cambridge|caie|cam|caie/.test(lw)) out.curriculum.push("Cambridge");
    else if (/zimsec/.test(lw)) out.curriculum.push("ZIMSEC");
    else if (/ib/.test(lw)) out.curriculum.push("IB");
    else if (/primary|junior/.test(lw)) out.schoolPhase = "Primary";
    else if (/secondary|high|senior/.test(lw)) out.schoolPhase = "Secondary";
    else if (/board|boarding/.test(lw)) out.type2.push("Boarding");
    else if (/day/.test(lw)) out.type2.push("Day");
    else if (/inperson|oncampus|residential/.test(lw)) out.learningEnvironment = "On campus";
    else out.facilities.push(w); // treat as facility word
  }

  // unique arrays
  out.curriculum = [...new Set(out.curriculum)];
  out.type2 = [...new Set(out.type2)];
  out.facilities = out.facilities.filter(Boolean);
  return out;
}

function getTwilioClient() {
  // Prefer subaccount creds if provided (useful when using a Twilio subaccount)
  const subSid = process.env.TWILIO_SUBACCOUNT_SID;
  const subToken = process.env.TWILIO_SUBACCOUNT_AUTH_TOKEN;
  if (subSid && subToken) return twilio(subSid, subToken);

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

/* Verify Twilio signature (robust, reconstructs full URL Twilio used) */
function verifyTwilioSignature(req) {
  if (process.env.DEBUG_TWILIO_SKIP_VERIFY === "1") {
    console.log("TWILIO_VERIFY: DEBUG skip enabled");
    return true;
  }
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn("TWILIO_VERIFY: TWILIO_AUTH_TOKEN not set - skipping verification");
    return true;
  }
  try {
    const signature = req.header("x-twilio-signature");
    const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
    const host = req.get("host");
    if (!host) {
      console.warn("TWILIO_VERIFY: missing host header");
      return false;
    }
    // reconstruct exact URL Twilio called
    const url = `${proto}://${host}${req.originalUrl}`;
    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) console.warn("TWILIO_VERIFY: signature invalid for", url);
    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY: error validating signature:", e?.message || e);
    return false;
  }
}

/* Send asynchronous reply via Twilio REST API */
async function sendAsyncReply(to, bodyText) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. 'whatsapp:+263784277776'
  if (!client || !from) {
    console.warn("TWILIO_SEND: missing client or TWILIO_WHATSAPP_FROM; cannot send reply");
    return;
  }
  try {
    await client.messages.create({
      from,
      to,
      body: bodyText,
    });
    console.log("TWILIO_SEND: message sent to", to);
  } catch (e) {
    console.error("TWILIO_SEND: failed to send message:", e && e.message ? e.message : e);
  }
}

/* ---------------- route: POST / (mount at /twilio/webhook in server.js) ---------------- */

router.post("/", (req, res) => {
  try {
    // log incoming raw info
    console.log("TWILIO: incoming webhook", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
    console.log("TWILIO: headers:", {
      host: req.get("host"),
      "x-forwarded-proto": req.get("x-forwarded-proto"),
      "x-twilio-signature": req.header("x-twilio-signature"),
      "content-type": req.get("content-type"),
    });
    console.log("TWILIO: body (raw):", req.body);

    // quick ack to Twilio so it won't retry
    quickTwimlAck(res, "Received");

    // background processing (do NOT block response)
    setImmediate(async () => {
      try {
        const ok = verifyTwilioSignature(req);
        if (!ok) {
          console.warn("TWILIO: request verification failed");
          return;
        }

        const params = req.body || {};
        const rawFrom = String(params.From || params.from || "");
        const bodyRaw = String(params.Body || params.body || "").trim();
        const profileName = String(params.ProfileName || params.profileName || "");
        console.log("TWILIO: parsed", { rawFrom, bodyRaw, profileName });

        if (!rawFrom) {
          console.warn("TWILIO: missing From value");
          return;
        }

        const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();

        // ensure user record; update name if changed
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

        // greeting/help: reply via REST so user sees a message
        if (!text || ["hi", "hello", "hey"].includes(text)) {
          const greeting =
            "Hi! I'm ZimEduFinder 🤖\n\nCommands:\n• find [city] — e.g. 'find harare'\n• find [city] boarding\n• find [city] cambridge primary day\n• fav add <slug>\n• help";
          await sendAsyncReply(rawFrom, greeting);
          return;
        }
        if (text === "help") {
          const help =
            "ZimEduFinder Help:\n• find [city] [filters]\nFilters: cambridge, zimsec, ib, primary, secondary, board/boarding, day\nExample: find harare cambridge boarding primary";
          await sendAsyncReply(rawFrom, help);
          return;
        }

        // parse filters
        const parsed = parseFiltersFromText(text);

        if (parsed.command === "find") {
          const prefs = {
            city: parsed.city || "Harare",
            curriculum: parsed.curriculum,
            learningEnvironment: parsed.learningEnvironment,
            schoolPhase: parsed.schoolPhase,
            type2: parsed.type2,
            facilities: parsed.facilities,
          };

          // Save to a safety field lastPrefsObj to avoid casting issues if your model uses lastPrefs as array
          try {
            await User.findOneAndUpdate(
              { provider: "whatsapp", providerId },
              { $set: { lastPrefsObj: prefs } },
              { upsert: true }
            );
            console.log("TWILIO: saved lastPrefsObj for", providerId);
          } catch (e) {
            console.error("TWILIO: failed saving lastPrefsObj:", e && e.message ? e.message : e);
          }

          // call internal recommend endpoint
          try {
            const site = (process.env.SITE_URL || "").replace(/\/$/, "");
            if (!site) throw new Error("SITE_URL not configured");
            const resp = await axios.post(
              `${site}/api/recommend`,
              {
                city: prefs.city,
                learningEnvironment: prefs.learningEnvironment,
                curriculum: prefs.curriculum,
                type2: prefs.type2,
                schoolPhase: prefs.schoolPhase,
                facilities: prefs.facilities,
              },
              { timeout: 8000 }
            );

            const recs = (resp.data && resp.data.recommendations) || [];
            if (!recs.length) {
              await sendAsyncReply(rawFrom, `No matches found for "${prefs.city}". Try 'find harare' or 'help'.`);
              return;
            }

            // Build message; include registration link only for st-eurit (or change slug condition)
            const lines = [`Top ${Math.min(5, recs.length)} matches for ${prefs.city}:`];
            for (const r of recs.slice(0, 5)) {
              const regUrl = buildRegisterUrlForSchool(r); // only visible for allowed school
              lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);
              if (r.website) lines.push(`  Website: ${r.website}`);
              if (regUrl) lines.push(`  Register: ${regUrl}`);
            }
            lines.push("\nReply 'help' for commands.");

            await sendAsyncReply(rawFrom, lines.join("\n"));
            console.log("TWILIO: sent recommendations to", rawFrom);
          } catch (e) {
            console.error("TWILIO: recommend call failed:", e && (e.message || e.response && e.response.data) ? (e.message || (e.response && e.response.data)) : e);
            await sendAsyncReply(rawFrom, "Search failed — please try again later.");
          }
          return;
        } // end find

        // fav add
        if (text.startsWith("fav add ") || text.startsWith("favorite add ")) {
          const slug = bodyRaw.split(/\s+/).slice(2).join(" ").trim();
          if (!slug) {
            await sendAsyncReply(rawFrom, "Please provide the school slug, e.g. 'fav add st-eurit-international-school'");
            return;
          }
          try {
            const site = (process.env.SITE_URL || "").replace(/\/$/, "");
            const resp = await axios.get(`${site}/api/school-by-slug/${encodeURIComponent(slug)}`, { timeout: 5000 }).catch(() => null);
            const school = resp && resp.data && resp.data.school;
            if (!school) {
              await sendAsyncReply(rawFrom, `School not found for slug "${slug}"`);
              return;
            }
            await User.findOneAndUpdate({ provider: "whatsapp", providerId }, { $addToSet: { favourites: school._id } }, { upsert: true });
            await sendAsyncReply(rawFrom, `Added "${school.name}" to your favourites.`);
            console.log("TWILIO: added favourite for", providerId);
          } catch (e) {
            console.error("TWILIO: fav add error:", e && e.message ? e.message : e);
            await sendAsyncReply(rawFrom, "Could not add favourite — try again later.");
          }
          return;
        }

        // fallback
        await sendAsyncReply(rawFrom, "Sorry, I didn't understand. Send 'help' for usage.");
      } catch (procErr) {
        console.error("TWILIO: processing error (inner):", procErr && procErr.stack ? procErr.stack : procErr);
      }
    }); // setImmediate
  } catch (err) {
    console.error("TWILIO: outer webhook handler error:", err && err.stack ? err.stack : err);
    // Already acked; nothing else to return.
  }
});

export default router;
