// routes/twilio_webhook.js
import express from "express";
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js";

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* ---------- Helpers ---------- */

function sendTwimlText(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text || "");
  res.set("Content-Type", "text/xml");
  return res.send(twiml.toString());
}

function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

/**
 * Parse words after the city into structured filters.
 * Example command:
 *   find harare cambridge boarding primary advanced girls swimming
 */
function parseFiltersFromWords(words) {
  const filters = {
    curriculum: [],
    type2: [],
    schoolPhase: [],
    learningEnvironment: "",
    gender: "",
    facilities: [],
  };

  const addUnique = (arr, val) => {
    if (!val) return;
    if (!arr.includes(val)) arr.push(val);
  };

  for (const raw of words) {
    const w = raw.toLowerCase();

    // ----- Curriculum -----
    if (/^cam(b|br)?(idg|rid)?e?$/.test(w) || w === "cambridge") {
      addUnique(filters.curriculum, "Cambridge");
      continue;
    }
    if (w === "zimsec") {
      addUnique(filters.curriculum, "Zimsec");
      continue;
    }
    if (w === "ib") {
      addUnique(filters.curriculum, "IB");
      continue;
    }

    // ----- Boarding / Day (type2) -----
    if (w === "boarding" || w === "board") {
      addUnique(filters.type2, "Boarding");
      continue;
    }
    if (w === "day") {
      addUnique(filters.type2, "Day");
      continue;
    }

    // ----- School phase -----
    if (w === "pre" || w === "preschool" || w === "pre-school" || w === "early") {
      addUnique(filters.schoolPhase, "Pre-School");
      continue;
    }
    if (w === "primary" || w === "junior") {
      addUnique(filters.schoolPhase, "Primary School");
      continue;
    }
    if (w === "high" || w === "secondary" || w === "senior") {
      addUnique(filters.schoolPhase, "High School");
      continue;
    }

    // ----- Learning environment -----
    if (w === "comprehensive" || w === "comp") {
      filters.learningEnvironment = "Comprehensive";
      continue;
    }
    if (w === "enhanced" || w === "enhance") {
      filters.learningEnvironment = "Enhanced";
      continue;
    }
    if (w === "advanced" || w === "advance") {
      filters.learningEnvironment = "Advanced";
      continue;
    }

    // ----- Gender -----
    if (w === "boys" || w === "boy") {
      filters.gender = "Boys";
      continue;
    }
    if (w === "girls" || w === "girl") {
      filters.gender = "Girls";
      continue;
    }
    if (w === "mixed" || w === "coed" || w === "co-ed") {
      filters.gender = "Mixed";
      continue;
    }

    // ----- Facilities -----

    // Academics
    if (w === "science" || w === "labs" || w === "lab") {
      addUnique(filters.facilities, "scienceLabs");
      continue;
    }
    if (w === "computer" || w === "ict" || w === "computers") {
      addUnique(filters.facilities, "computerLab");
      continue;
    }
    if (w === "library" || w === "libraries") {
      addUnique(filters.facilities, "library");
      continue;
    }
    if (w === "steam" || w === "robotics" || w === "maker") {
      addUnique(filters.facilities, "makerSpaceSteamLab");
      continue;
    }
    if (w === "cambridgecentre" || w === "cambridgecenter") {
      addUnique(filters.facilities, "examCentreCambridge");
      continue;
    }
    if (w === "zimseccentre") {
      addUnique(filters.facilities, "examCentreZimsec");
      continue;
    }

    // Sports
    if (w === "swimming" || w === "swim" || w === "pool") {
      addUnique(filters.facilities, "swimmingPool");
      continue;
    }
    if (w === "rugby") {
      addUnique(filters.facilities, "rugbyField");
      continue;
    }
    if (w === "hockey") {
      addUnique(filters.facilities, "hockeyField");
      continue;
    }
    if (w === "tennis") {
      addUnique(filters.facilities, "tennisCourts");
      continue;
    }
    if (w === "basketball") {
      addUnique(filters.facilities, "basketballCourt");
      continue;
    }
    if (w === "football" || w === "soccer") {
      addUnique(filters.facilities, "footballPitch");
      continue;
    }
    if (w === "cricket") {
      addUnique(filters.facilities, "cricketField");
      continue;
    }

    // Support & welfare
    if (w === "counselling" || w === "counseling") {
      addUnique(filters.facilities, "counseling");
      continue;
    }
    if (w === "sen") {
      addUnique(filters.facilities, "learningSupportSEN");
      continue;
    }
    if (w === "clinic" || w === "nurse") {
      addUnique(filters.facilities, "schoolClinicNurse");
      continue;
    }
    if (w === "aftercare" || w === "after") {
      addUnique(filters.facilities, "aftercare");
      continue;
    }

    // Boarding & logistics
    if (w === "transport" || w === "bus" || w === "buses") {
      addUnique(filters.facilities, "transportBuses");
      continue;
    }

    // Campus & safety
    if (w === "wifi" || w === "wi-fi") {
      addUnique(filters.facilities, "wifiCampus");
      continue;
    }
    if (w === "cctv" || w === "security") {
      addUnique(filters.facilities, "cctvSecurity");
      continue;
    }
    if (w === "generator" || w === "backup" || w === "power") {
      addUnique(filters.facilities, "powerBackup");
      continue;
    }
  }

  return filters;
}

/* ---------- Main Webhook ---------- */

router.post("/webhook", async (req, res) => {
  try {
    const params = req.body || {};
    const rawFrom = String(params.From || "");
    const bodyRaw = String(params.Body || "").trim();
    const profileName = String(params.ProfileName || "");

    if (!rawFrom) return sendTwimlText(res, "Missing sender info");

    const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();
    const providerIdNormalized = normalizePhone(providerId);

    /* ---------- Load / create user (no duplicates) ---------- */

    let user = await User.findOne({ provider: "whatsapp", providerId });

    if (!user) {
      user = await User.create({
        provider: "whatsapp",
        providerId,
        phone: providerIdNormalized || undefined,
        name: profileName || undefined,
        role: "user",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        lastMessage: bodyRaw || undefined,
      });
      console.log("TWILIO: created user", user._id?.toString());
    } else {
      let changed = false;

      if (profileName && user.name !== profileName) {
        user.name = profileName;
        changed = true;
      }

      if (providerIdNormalized && user.phone !== providerIdNormalized) {
        user.phone = providerIdNormalized;
        changed = true;
      }

      user.lastSeenAt = new Date();
      if (bodyRaw) {
        user.lastMessage = bodyRaw;
        changed = true;
      }

      if (changed) {
        await user.save();
        console.log("TWILIO: updated user", user._id?.toString());
      }
    }

    const text = (bodyRaw || "").trim();
    const lctext = text.toLowerCase();

    /* ---------- Help + menu text ---------- */

    const helpMessage = [
      "Hi! I'm ZimEduFinder",
      "",
      "You can either *type a search* or *reply with a number*.",
      "",
      "🔢 Quick options:",
      "1) Harare Cambridge (all levels)",
      "2) Harare Cambridge boarding primary",
      "3) Harare boarding (any curriculum)",
      "4) Harare schools with swimming pool",
      "5) Help / all filters & examples",
      "",
      "📝 Or type:",
      "find [city] [filters]",
      "",
      "Examples you can type:",
      "find harare cambridge",
      "find harare primary advanced",
      "find harare boarding swimming",
      "find harare cambridge advanced mixed",
      "find harare cambridge boarding primary enhanced mixed swimming",
      "",
      "Learning environment: comprehensive, enhanced, advanced",
      "Gender: boys, girls, mixed",
      "Curriculum: cambridge, zimsec, ib",
      "Phases: pre, primary, high",
      "Facilities: science, computer, library, robotics, cambridgecentre, zimseccentre, swimming, rugby, hockey, tennis, basketball, football, cricket, counselling, sen, clinic, aftercare, transport, wifi, cctv, generator",
      "",
      "⭐ Other:",
      "help",
    ].join("\n");

    /* ---------- hi / help / menu ---------- */

    if (!lctext || ["hi", "hello", "hey", "menu", "options"].includes(lctext)) {
      return sendTwimlText(res, helpMessage);
    }

    if (lctext === "help") {
      return sendTwimlText(res, helpMessage);
    }

    /* ---------- Map numeric shortcuts to commands ---------- */

    let command = lctext;

    if (/^[1-5]$/.test(lctext)) {
      switch (lctext) {
        case "1":
          command = "find harare cambridge";
          break;
        case "2":
          command = "find harare cambridge boarding primary";
          break;
        case "3":
          command = "find harare boarding";
          break;
        case "4":
          command = "find harare swimming";
          break;
        case "5":
          return sendTwimlText(res, helpMessage);
        default:
          break;
      }
    }

    /* ---------- fav add / favorite add ---------- */

    if (command.startsWith("fav add ") || command.startsWith("favorite add ")) {
      const slug = bodyRaw.split(/\s+/).slice(2).join(" ").trim();
      if (!slug) {
        return sendTwimlText(
          res,
          "Please provide the school slug, e.g. 'fav add st-eurit-international-school'"
        );
      }

      try {
        const site = (process.env.SITE_URL || "").replace(/\/$/, "");
        if (!site) {
          console.error("SITE_URL env missing for fav add");
          return sendTwimlText(
            res,
            "Cannot add favourites right now. Please try later."
          );
        }

        const resp = await axios
          .get(`${site}/api/school-by-slug/${encodeURIComponent(slug)}`, {
            timeout: 5000,
          })
          .catch(() => null);

        const school = resp?.data?.school;
        if (!school) {
          return sendTwimlText(
            res,
            `School not found for slug "${slug}". Please check the link on the website and try again.`
          );
        }

        await User.findOneAndUpdate(
          { provider: "whatsapp", providerId },
          { $addToSet: { favourites: school._id } },
          { upsert: true }
        );

        return sendTwimlText(
          res,
          `Added "${school.name}" to your favourites.`
        );
      } catch (e) {
        console.error("TWILIO: fav add error:", e?.message || e);
        return sendTwimlText(
          res,
          "Could not add favourite | please try again later."
        );
      }
    }

    /* ---------- FIND COMMAND (works for typed or numeric-mapped) ---------- */

    const words = command.split(/\s+/).filter(Boolean);

    if (words[0] === "find") {
      const cityWord = (words[1] || "harare").toLowerCase();
      const niceCity = cityWord.charAt(0).toUpperCase() + cityWord.slice(1);

      // everything after city is filters
      const filterWords = words.slice(2);
      const parsed = parseFiltersFromWords(filterWords);

      const curriculum = parsed.curriculum;
      const type2 = parsed.type2;
      const schoolPhase = parsed.schoolPhase;
      const learningEnvironment = parsed.learningEnvironment || undefined;
      const gender = parsed.gender || undefined;
      const facilities = parsed.facilities;

      // Save user prefs
      try {
        user.lastPrefs = {
          city: niceCity,
          curriculum,
          type2,
          schoolPhase,
          learningEnvironment,
          gender,
          facilities,
        };
        await user.save();
      } catch (e) {
        console.warn("TWILIO: failed to save lastPrefs:", e?.message || e);
      }

      const site = (process.env.SITE_URL || "").replace(/\/$/, "");
      if (!site) {
        console.error("SITE_URL env missing");
        return sendTwimlText(
          res,
          "Search currently unavailable. Please try again later."
        );
      }

      let recs = [];
      try {
        const payload = {
          city: niceCity,
          curriculum,
          type2,
          schoolPhase,
          learningEnvironment,
          gender,
          facilities,
        };

        console.log("TWILIO: calling /api/recommend with:", payload);
        const resp = await axios.post(`${site}/api/recommend`, payload, {
          timeout: 10000,
        });
        recs = resp.data?.recommendations || [];
      } catch (e) {
        console.error(
          "TWILIO: /api/recommend error:",
          e?.message || e?.toString()
        );
        return sendTwimlText(
          res,
          "Search failed | please try again in a moment."
        );
      }

      if (!recs.length) {
        return sendTwimlText(
          res,
          `No schools found for "${niceCity}" with those filters. Try removing some filters or send 'help'.`
        );
      }

      const lines = [
        `Top ${Math.min(5, recs.length)} matches for ${niceCity.toLowerCase()}:`,
      ];

      let attachStEuritMedia = false;

      for (const r of recs.slice(0, 5)) {
        lines.push(`\n• ${r.name}${r.city ? " | " + r.city.toLowerCase() : ""}`);

        if (r.curriculum) {
          lines.push(
            `  Curriculum: ${
              Array.isArray(r.curriculum)
                ? r.curriculum.join(", ")
                : r.curriculum
            }`
          );
        }
        if (r.learningEnvironment) {
          lines.push(`  Learning environment: ${r.learningEnvironment}`);
        }
        if (r.gender) {
          lines.push(`  Gender: ${r.gender}`);
        }
        if (r.website) lines.push(`  Website: ${r.website}`);

        const name = (r.name || "").toLowerCase();
        const slug = r.slug || "";

        // Detect St Eurit (pinned school)
        if (/st[\s-]*eurit/.test(name) || /st-eurit/.test(slug)) {
          attachStEuritMedia = true;
          lines.push(
            `  Register: https://skoolfinder.net/register/st-eurit-international-school`
          );
        }
      }

      const twiml = new MessagingResponse();

      /* ---------- MEDIA FIRST (ONLY ST EURIT) ---------- */

      if (attachStEuritMedia) {
        const mediaBase = site;

        const img1 = twiml.message(
          "⭐ Pinned school: St Eurit International School\n📍 City: harare\n📘 Curriculum: Cambridge\nTo apply:\n👉 Register: https://skoolfinder.net/register/st-eurit-international-school"
        );
        img1.media(`${mediaBase}/docs/st-eurit.jpg`);

        const img2 = twiml.message("St Eurit | second view");
        img2.media(`${mediaBase}/docs/st-eurit-pic2.jpg`);

        const pdf1 = twiml.message("St Eurit | School Profile (PDF)");
        pdf1.media(`${mediaBase}/docs/st-eurit-profile.pdf`);

        const pdf2 = twiml.message("St Eurit | Registration Form (PDF)");
        pdf2.media(`${mediaBase}/docs/st-eurit-registration.pdf`);

        const pdf3 = twiml.message("St Eurit | Enrolment Requirements (PDF)");
        pdf3.media(
          `${mediaBase}/docs/st-eurit-enrollment-requirements.pdf`
        );
      }

      /* ---------- TEXT LIST LAST (ALL SCHOOLS) ---------- */

      twiml.message(lines.join("\n"));

      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    /* ---------- Fallback: anything else → full menu ---------- */

    return sendTwimlText(res, helpMessage);
  } catch (err) {
    console.error("TWILIO ERROR:", err);
    // Even on error, send the menu so user isn't stuck
    return sendTwimlText(res, "Something went wrong.\n\n" + err?.message || "" );
  }
});

export default router;
