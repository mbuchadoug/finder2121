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
  try {
    const twiml = new MessagingResponse();
    twiml.message(text || "");
    res.set("Content-Type", "text/xml");
    return res.send(twiml.toString());
  } catch (e) {
    console.error("sendTwimlText error:", e?.message || e);
    res.set("Content-Type", "text/plain");
    return res.send(String(text || ""));
  }
}

function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

/**
 * Very forgiving word → filters mapper.
 * We NEVER throw here – unknown words are just ignored.
 */
function parseFiltersFromWords(words) {
  const filters = {
    curriculum: [],          // ["Cambridge", "Zimsec", "IB"]
    type2: [],               // ["Day", "Boarding"]
    schoolPhase: [],         // ["Pre-School", "Primary School", "High School"]
    learningEnvironment: "", // "Comprehensive" | "Enhanced" | "Advanced"
    gender: "",              // "Boys" | "Girls" | "Mixed"
    facilities: []           // list of facility labels
  };

  const addUnique = (arr, val) => {
    if (!val) return;
    if (!arr.includes(val)) arr.push(val);
  };

  for (const raw of words) {
    const w = raw.toLowerCase();

    // curriculum
    if (/^camb?r?idg?e$/.test(w) || /cambridge/.test(w)) {
      addUnique(filters.curriculum, "Cambridge");
      continue;
    }
    if (/zimsec/.test(w)) {
      addUnique(filters.curriculum, "Zimsec");
      continue;
    }
    if (/^ib$/.test(w)) {
      addUnique(filters.curriculum, "IB");
      continue;
    }

    // boarding / day
    if (/board|boarding/.test(w)) {
      addUnique(filters.type2, "Boarding");
      continue;
    }
    if (/^day$/.test(w)) {
      addUnique(filters.type2, "Day");
      continue;
    }

    // school phase
    if (/pre[- ]?school/.test(w)) {
      addUnique(filters.schoolPhase, "Pre-School");
      continue;
    }
    if (/primary/.test(w)) {
      addUnique(filters.schoolPhase, "Primary School");
      continue;
    }
    if (/high|secondary/.test(w)) {
      addUnique(filters.schoolPhase, "High School");
      continue;
    }

    // learning environment
    if (/advanced/.test(w)) {
      filters.learningEnvironment = "Advanced";
      continue;
    }
    if (/enhanced/.test(w)) {
      filters.learningEnvironment = "Enhanced";
      continue;
    }
    if (/comprehensive|standard|core/.test(w)) {
      filters.learningEnvironment = "Comprehensive";
      continue;
    }

    // gender
    if (/boys?/.test(w)) {
      filters.gender = "Boys";
      continue;
    }
    if (/girls?/.test(w)) {
      filters.gender = "Girls";
      continue;
    }
    if (/mixed|coed|co-ed/.test(w)) {
      filters.gender = "Mixed";
      continue;
    }

    // facilities (very loose matching)
    if (/science/.test(w)) {
      addUnique(filters.facilities, "Science Labs");
      continue;
    }
    if (/computer|ict|it/.test(w)) {
      addUnique(filters.facilities, "Computer Lab");
      continue;
    }
    if (/library/.test(w)) {
      addUnique(filters.facilities, "Library");
      continue;
    }
    if (/steam|robot/.test(w)) {
      addUnique(filters.facilities, "STEAM / Robotics");
      continue;
    }
    if (/cambridgecent(er|re)|cambridgecentre/.test(w)) {
      addUnique(filters.facilities, "Cambridge Centre");
      continue;
    }
    if (/zimsec/.test(w)) {
      addUnique(filters.facilities, "ZIMSEC Centre");
      continue;
    }
    if (/swim|pool/.test(w)) {
      addUnique(filters.facilities, "Swimming Pool");
      continue;
    }
    if (/rugby/.test(w)) {
      addUnique(filters.facilities, "Rugby");
      continue;
    }
    if (/hockey/.test(w)) {
      addUnique(filters.facilities, "Hockey");
      continue;
    }
    if (/tennis/.test(w)) {
      addUnique(filters.facilities, "Tennis");
      continue;
    }
    if (/basketball/.test(w)) {
      addUnique(filters.facilities, "Basketball");
      continue;
    }
    if (/football|soccer/.test(w)) {
      addUnique(filters.facilities, "Football");
      continue;
    }
    if (/counsel+ing/.test(w)) {
      addUnique(filters.facilities, "Counselling");
      continue;
    }
    if (/sen|support/.test(w)) {
      addUnique(filters.facilities, "Learning Support (SEN)");
      continue;
    }
    if (/clinic|nurse/.test(w)) {
      addUnique(filters.facilities, "School Clinic / Nurse");
      continue;
    }
    if (/aftercare|after-school/.test(w)) {
      addUnique(filters.facilities, "Aftercare");
      continue;
    }
    if (/transport|bus/.test(w)) {
      addUnique(filters.facilities, "School Transport");
      continue;
    }
    // "boarding" as facility is already captured under type2
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

    console.log("TWILIO webhook hit:", {
      from: rawFrom,
      body: bodyRaw,
      profileName,
    });

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

    const text = bodyRaw || "";
    const lctext = text.toLowerCase().trim();

    /* ---------- Basic commands ---------- */

    const site = (process.env.SITE_URL || "").replace(/\/$/, "");
    const mediaBase = site || "https://skoolfinder.net";

    if (!lctext || ["hi", "hello", "hey"].includes(lctext)) {
      const helpText = [
        "Hi! I'm ZimEduFinder 🤖",
        "",
        "You can search like this:",
        "• find [city] [filters]",
        "",
        "🧭 City:",
        "  harare, bulawayo, mutare, gweru, masvingo, etc.",
        "",
        "🏫 Learning environment:",
        "  comprehensive, enhanced, advanced",
        "",
        "📘 Curriculum:",
        "  cambridge, zimsec, ib",
        "",
        "🎓 School phase:",
        "  preschool, primary, high / secondary",
        "",
        "🛏 Boarding / Day:",
        "  boarding, day",
        "",
        "🚻 Gender:",
        "  boys, girls, mixed",
        "",
        "🏟 Facilities keywords:",
        "  science, computer, library, robotics, cambridgecentre, zimseccentre,",
        "  swimming, rugby, hockey, tennis, basketball, football,",
        "  counselling, sen, clinic, aftercare, transport, boarding",
        "",
        "✅ Examples you can type:",
        "  find harare cambridge",
        "  find harare primary girls",
        "  find harare boarding swimming",
        "  find harare cambridge advanced mixed",
        "  find harare cambridge boarding primary enhanced girls swimming",
        "",
        "⭐ Other:",
        "  fav add <slug>",
        "  help",
      ].join("\n");

      return sendTwimlText(res, helpText);
    }

    if (lctext === "help") {
      const helpText = [
        "ZimEduFinder Help 🤖",
        "",
        "Type:",
        "  find [city] [filters]",
        "",
        "Filters you can use:",
        "• City: harare, bulawayo, mutare, gweru, masvingo, etc.",
        "• Learning environment: comprehensive, enhanced, advanced",
        "• Curriculum: cambridge, zimsec, ib",
        "• School phase: preschool, primary, high / secondary",
        "• Boarding/Day: boarding, day",
        "• Gender: boys, girls, mixed",
        "• Facilities: science, computer, library, robotics, cambridgecentre,",
        "             zimseccentre, swimming, rugby, hockey, tennis, basketball,",
        "             football, counselling, sen, clinic, aftercare, transport",
        "",
        "Examples:",
        "  find harare cambridge",
        "  find harare primary girls",
        "  find harare boarding swimming",
        "  find harare cambridge advanced mixed",
        "  find harare cambridge boarding primary enhanced girls swimming",
      ].join("\n");

      return sendTwimlText(res, helpText);
    }

    /* ---------- FIND COMMAND ---------- */

    const words = lctext.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      const city = (words[1] || "harare").trim();
      const filterWords = words.slice(2);

      // always include old simple behaviour
      const wantsBoarding = filterWords.some((w) => /board|boarding/.test(w));
      const type2Basic = wantsBoarding ? ["Boarding"] : [];

      const curriculumBasic = filterWords.filter((w) =>
        /cambridge|caie|zimsec|ib/.test(w)
      );

      // new, richer filters (but safe)
      const parsed = parseFiltersFromWords(filterWords);

      // merge basic + parsed so we don't lose old behaviour
      const curriculum = [
        ...new Set([
          ...curriculumBasic.map((c) =>
            /zimsec/.test(c) ? "Zimsec" : /ib/.test(c) ? "IB" : "Cambridge"
          ),
          ...parsed.curriculum,
        ]),
      ];
      const type2 = [
        ...new Set([
          ...type2Basic,
          ...parsed.type2,
        ]),
      ];

      const lastPrefs = {
        city,
        curriculum,
        type2,
        schoolPhase: parsed.schoolPhase,
        learningEnvironment: parsed.learningEnvironment || undefined,
        gender: parsed.gender || undefined,
        facilities: parsed.facilities,
      };

      // Save user search preferences (extra details)
      try {
        user.lastPrefs = lastPrefs;
        await user.save();
      } catch (e) {
        console.warn("TWILIO: failed to save lastPrefs:", e?.message || e);
      }

      if (!site) {
        console.error("SITE_URL env missing");
        return sendTwimlText(
          res,
          "Search is currently unavailable. Please try again later."
        );
      }

      let resp;
      try {
        resp = await axios.post(`${site}/api/recommend`, {
          city: lastPrefs.city,
          curriculum: lastPrefs.curriculum,
          learningEnvironment: lastPrefs.learningEnvironment,
          schoolPhase: lastPrefs.schoolPhase,
          type2: lastPrefs.type2,
          gender: lastPrefs.gender,
          facilities: lastPrefs.facilities,
        });
      } catch (e) {
        console.error(
          "TWILIO: /api/recommend failed:",
          e?.response?.data || e?.message || e
        );
        return sendTwimlText(
          res,
          "Sorry, the search failed. Please try again in a moment."
        );
      }

      const recs = (resp.data && resp.data.recommendations) || [];
      if (!recs.length)
        return sendTwimlText(
          res,
          `No schools found for "${city}". Try fewer filters or just "find ${city} cambridge".`
        );

      const lines = [`Top ${Math.min(5, recs.length)} matches for ${city}:`];
      let attachStEuritMedia = false;

      for (const r of recs.slice(0, 5)) {
        lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);

        if (r.curriculum) {
          const cur =
            Array.isArray(r.curriculum) && r.curriculum.length
              ? r.curriculum.join(", ")
              : r.curriculum;
          lines.push(`  Curriculum: ${cur}`);
        }
        if (r.fees) lines.push(`  Fees: ${r.fees}`);
        if (r.website) lines.push(`  Website: ${r.website}`);

        const name = (r.name || "").toLowerCase();
        const slug = r.slug || "";

        // Detect St Eurit (pinned school)
        if (/st[\s-]*eurit/.test(name) || /st-eurit/.test(slug)) {
          attachStEuritMedia = true;
          lines.push(
            "  Register: https://skoolfinder.net/register/st-eurit-international-school"
          );
        }
      }

      const twiml = new MessagingResponse();

      /* ---------- MEDIA FIRST (ONLY ST EURIT) ---------- */

      if (attachStEuritMedia) {
        console.log("TWILIO: attaching St Eurit media for", providerId);

        // Images
        const img1 = twiml.message(
          "Pinned school: St Eurit International School – Campus"
        );
        img1.media(`${mediaBase}/docs/st-eurit.jpg`);

        const img2 = twiml.message("St Eurit – second view");
        img2.media(`${mediaBase}/docs/st-eurit-pic2.jpg`);

        // PDFs
        const pdfProfile = twiml.message("St Eurit – School Profile (PDF)");
        pdfProfile.media(`${mediaBase}/docs/st-eurit-profile.pdf`);

        const pdfReg = twiml.message("St Eurit – Registration Form (PDF)");
        pdfReg.media(`${mediaBase}/docs/st-eurit-registration.pdf`);

        const pdfEnroll = twiml.message(
          "St Eurit – Enrolment Requirements (PDF)"
        );
        pdfEnroll.media(
          `${mediaBase}/docs/st-eurit-enrollment-requirements.pdf`
        );
      }

      /* ---------- TEXT LIST LAST (ALL SCHOOLS) ---------- */

      twiml.message(lines.join("\n"));

      res.set("Content-Type", "text/xml");
      return res.send(twiml.toString());
    }

    /* ---------- Favourites (unchanged simple version) ---------- */

    if (lctext.startsWith("fav add ") || lctext.startsWith("favorite add ")) {
      const slug = bodyRaw.split(/\s+/).slice(2).join(" ").trim();
      if (!slug) {
        return sendTwimlText(
          res,
          "Please provide the school slug, e.g. 'fav add st-eurit-international-school'"
        );
      }

      try {
        if (!site) throw new Error("SITE_URL not configured");
        const resp = await axios
          .get(`${site}/api/school-by-slug/${encodeURIComponent(slug)}`, {
            timeout: 5000,
          })
          .catch(() => null);

        const school = resp && resp.data && resp.data.school;
        if (!school) {
          return sendTwimlText(res, `School not found for slug "${slug}"`);
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
          "Could not add favourite right now. Please try again later."
        );
      }
    }

    /* ---------- Fallback ---------- */

    return sendTwimlText(
      res,
      'Sorry, I did not understand that. Send "help" to see how to search.'
    );
  } catch (err) {
    console.error("TWILIO webhook fatal error:", err);
    try {
      return sendTwimlText(
        res,
        "Oops, something went wrong on our side. Please try again."
      );
    } catch {
      return res.status(500).end();
    }
  }
});

export default router;
