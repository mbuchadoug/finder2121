// routes/twilio_webhook.js  (replace your existing file)
import express from "express";
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import User from "../models/user.js"; // ensure this path matches your project

import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const router = Router();

// Ensure router parses form-encoded bodies (Twilio uses application/x-www-form-urlencoded)
router.use(express.urlencoded({ extended: true }));

// ---------- helpers ----------
function sendTwimlText(res, text) {
  try {
    const twiml = new MessagingResponse();
    twiml.message(text || "");
    res.set("Content-Type", "text/xml");
    return res.send(twiml.toString());
  } catch (e) {
    // fallback
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
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

// strip formatting and any "whatsapp:" prefix to produce only digits for comparisons
function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/^whatsapp:/i, "").replace(/\D+/g, "");
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
    // Important: Twilio expects the *raw* params used in the signature check.
    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) console.warn("TWILIO_VERIFY: signature invalid for", url, "signature:", signature);
    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY: error:", e?.message || e);
    return false;
  }
}

// ---------- persistent counters (simple file-based) ----------
const DATA_DIR = path.join(process.cwd(), "data");
const COUNTER_FILE = path.join(DATA_DIR, "admin_counters.json");

async function ensureDataDir() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  } catch (e) {
    // ignore
  }
}

async function loadCounters() {
  await ensureDataDir();
  try {
    const raw = await fs.promises.readFile(COUNTER_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    return {
      invoice: 0,
      quote: 0,
      receipt: 0,
    };
  }
}

async function saveCounters(obj) {
  await ensureDataDir();
  await fs.promises.writeFile(COUNTER_FILE, JSON.stringify(obj, null, 2), "utf8");
}

async function incrementCounter(type) {
  const counters = await loadCounters();
  if (!counters[type]) counters[type] = 0;
  counters[type] = Number(counters[type]) + 1;
  await saveCounters(counters);
  return counters[type];
}

// ---------- PDF generation helpers (pdfkit) ----------
async function ensurePublicSubdirs() {
  const base = path.join(process.cwd(), "public", "docs", "generated");
  await fs.promises.mkdir(base, { recursive: true });
  for (const sub of ["invoices", "quotes", "receipts"]) {
    await fs.promises.mkdir(path.join(base, sub), { recursive: true });
  }
  return base;
}

function formatMoney(n) {
  return Number(n || 0).toFixed(2);
}

function drawTable(doc, items, startX, startY, columnWidths) {
  // very simple table renderer
  const lineHeight = 18;
  let y = startY;
  doc.fontSize(10);
  doc.text("Description", startX, y, { width: columnWidths[0] });
  doc.text("Qty", startX + columnWidths[0] + 10, y, { width: columnWidths[1], align: "right" });
  doc.text("Unit", startX + columnWidths[0] + 10 + columnWidths[1] + 10, y, { width: columnWidths[2], align: "right" });
  doc.text("Total", startX + columnWidths[0] + 10 + columnWidths[1] + 10 + columnWidths[2] + 10, y, { width: columnWidths[3], align: "right" });
  y += lineHeight;
  doc.moveTo(startX, y - 6).lineTo(startX + columnWidths.reduce((a,b) => a + b, 0) + 40, y - 6).strokeOpacity(0.1).stroke();
  for (const it of items) {
    doc.text(it.description, startX, y, { width: columnWidths[0] });
    doc.text(String(it.qty), startX + columnWidths[0] + 10, y, { width: columnWidths[1], align: "right" });
    doc.text(formatMoney(it.unit), startX + columnWidths[0] + 10 + columnWidths[1] + 10, y, { width: columnWidths[2], align: "right" });
    doc.text(formatMoney((it.qty||0) * (it.unit||0)), startX + columnWidths[0] + 10 + columnWidths[1] + 10 + columnWidths[2] + 10, y, { width: columnWidths[3], align: "right" });
    y += lineHeight;
  }
  return y;
}

async function generatePDF({ type, number, date, dueDate, billingTo, email, items = [], notes = "" }) {
  // type: 'invoice' | 'quote' | 'receipt'
  const now = new Date();
  const baseDir = await ensurePublicSubdirs();
  const folder = path.join(baseDir, type === "invoice" ? "invoices" : type === "quote" ? "quotes" : "receipts");
  const filename = `${type}-${number}-${Date.now()}.pdf`;
  const filepath = path.join(folder, filename);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // Branding / header
      const logoPath = path.join(process.cwd(), "public", "docs", "logo.png"); // adjust if needed
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 45, { width: 90 });
      }
      doc.fontSize(20).text(type === "invoice" ? "INVOICE" : type === "quote" ? "QUOTATION" : "RECEIPT", 400, 50, { align: "right" });
      doc.fontSize(10).text(`No: ${number}`, 400, 75, { align: "right" });
      doc.text(`Date: ${date.toISOString().slice(0,10)}`, 400, 90, { align: "right" });
      if (dueDate) doc.text(`Due: ${dueDate.toISOString().slice(0,10)}`, 400, 105, { align: "right" });

      doc.moveDown(4);

      // Billing
      doc.fontSize(12).text("Bill To:", 50, 140);
      doc.fontSize(11).text(billingTo || "-", 50, 155);
      if (email) doc.fontSize(10).text(email, 50, 170);

      // Items table
      const startY = 210;
      const columnWidths = [260, 60, 80, 80];
      const afterTableY = drawTable(doc, items, 50, startY, columnWidths);

      // Totals
      let subtotal = items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit||0)), 0);
      const tax = 0; // keep simple (extendable)
      const total = subtotal + tax;

      doc.fontSize(10).text(`Subtotal: ${formatMoney(subtotal)}`, 400, afterTableY + 10, { align: "right" });
      if (tax) doc.text(`Tax: ${formatMoney(tax)}`, 400, afterTableY + 25, { align: "right" });
      doc.fontSize(12).text(`Total: ${formatMoney(total)}`, 400, afterTableY + 40, { align: "right" });

      // Notes
      if (notes) {
        doc.moveDown(2);
        doc.fontSize(10).text("Notes:", 50, afterTableY + 80);
        doc.fontSize(9).text(notes, 50, afterTableY + 95, { width: 400 });
      }

      // Footer
      doc.fontSize(9).fillColor("gray").text("Generated by ZimEduFinder", 50, 760, { align: "center", width: 500 });

      doc.end();
      stream.on("finish", () => resolve({ filepath, filename }));
      stream.on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

// ---------- admin command parsing ----------
function parseAdminCommand(bodyRaw) {
  // expected format (pipe-separated):
  // invoice create|customer:Name|email:someone@x.com|item:desc,qty,unit|item:desc,qty,unit|due:YYYY-MM-DD|notes:...
  // quote create|... same fields
  // receipt create|amount:100|description:Payment for X|customer:Name|email:...
  const parts = bodyRaw.split("|").map(p => p.trim()).filter(Boolean);
  const command = parts.shift() || "";
  // command is like "invoice create"
  const cmdWords = command.split(/\s+/).filter(Boolean);
  const action = (cmdWords[0] || "").toLowerCase();
  const verb = (cmdWords[1] || "").toLowerCase();

  const result = { raw: bodyRaw, action, verb, fields: {} };

  for (const p of parts) {
    const idx = p.indexOf(":");
    if (idx === -1) {
      // treat as free text note
      if (!result.fields._text) result.fields._text = [];
      result.fields._text.push(p);
      continue;
    }
    const key = p.slice(0, idx).trim().toLowerCase();
    const val = p.slice(idx + 1).trim();
    if (key === "item") {
      // item:desc,qty,unit (unit optional)
      if (!result.fields.items) result.fields.items = [];
      const itemParts = val.split(",").map(x => x.trim());
      const description = itemParts[0] || "";
      const qty = Number(itemParts[1] || 1);
      const unit = Number(itemParts[2] || 0);
      result.fields.items.push({ description, qty, unit });
    } else {
      // normal key
      result.fields[key] = val;
    }
  }

  return result;
}

// ---------- main webhook ----------
router.post("/webhook", async (req, res) => {
  // Aggressive top-level logging to ensure we see everything
  console.log("TWILIO: webhook hit ->", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
  console.log("TWILIO: debug env:", {
    SITE_URL: process.env.SITE_URL ? "[set]" : "[missing]",
    DEBUG_TWILIO_SKIP_VERIFY: process.env.DEBUG_TWILIO_SKIP_VERIFY || "[not set]",
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? "[set]" : "[missing]"
  });

  console.log("TWILIO: headers:", {
    host: req.get("host"),
    "x-forwarded-proto": req.get("x-forwarded-proto"),
    "x-twilio-signature": req.header("x-twilio-signature"),
    "content-type": req.get("content-type"),
  });

  // Print body safely (avoid circular)
  try {
    console.log("TWILIO: body (raw):", JSON.stringify(req.body));
  } catch (e) {
    console.log("TWILIO: body (raw) - non-serializable; keys:", Object.keys(req.body || {}));
  }

  // Verify request signature (or skip if debug)
  const ok = verifyTwilioRequest(req);
  if (!ok) {
    console.warn("TWILIO: request verification failed -> replying 403 (signature mismatch or missing headers)");
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
    const providerIdNormalized = normalizePhone(providerId); // digits only

    // ADMIN NUMBERS (edit here or move to env)
    const adminNumbers = [
      normalizePhone("+263 789 901 058"),
      normalizePhone("+263 774 716 074")
    ];

    // If admin, try to parse admin commands
    if (adminNumbers.includes(providerIdNormalized)) {
      console.log("TWILIO: admin command from", providerId);
      // show help when empty or greeting
      const trimmed = (bodyRaw || "").trim();
      const lctext = trimmed.toLowerCase();
      if (!lctext || ["hi","hello","hey"].includes(lctext)) {
        const help = `Admin commands:
invoice create|customer:Name|email:em@ill|item:Desc,qty,unit|item:Desc,qty,unit|due:YYYY-MM-DD|notes:...
quote create|customer:Name|email:em@ill|item:Desc,qty,unit|...
receipt create|amount:100|description:Payment|customer:Name|email:...`;
        return sendTwimlText(res, help);
      }

      // parse
      const parsed = parseAdminCommand(bodyRaw);
      try {
        if (!parsed.action || !parsed.verb) {
          return sendTwimlText(res, "Invalid admin command. Send 'hi' for usage.");
        }

        if (["invoice","quote","receipt"].includes(parsed.action) && parsed.verb === "create") {
          if (parsed.action === "receipt") {
            // receipt expects amount
            const amount = Number(parsed.fields.amount || parsed.fields.total || 0);
            if (isNaN(amount) || amount <= 0) {
              return sendTwimlText(res, "Receipt creation failed: invalid or missing amount. Use amount:100");
            }
            // generate number & pdf
            const num = await incrementCounter("receipt");
            const numberStr = `R-${String(num).padStart(6, "0")}`;
            const date = new Date();
            const billingTo = parsed.fields.customer || parsed.fields.name || "";
            const email = parsed.fields.email || "";
            const items = [{ description: parsed.fields.description || "Payment", qty: 1, unit: amount }];

            const { filename } = await generatePDF({
              type: "receipt",
              number: numberStr,
              date,
              dueDate: null,
              billingTo,
              email,
              items,
              notes: parsed.fields.notes || ""
            });

            const site = (process.env.SITE_URL || "").replace(/\/$/, "");
            const baseForMedia = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
            const url = `${baseForMedia}/docs/generated/receipts/${filename}`;
            return sendTwimlWithMedia(res, `Receipt ${numberStr} created. Download: ${url}`, [url]);
          }

          // invoice or quote
          const type = parsed.action === "invoice" ? "invoice" : "quote";
          const numValue = await incrementCounter(type);
          const numberStr = (type === "invoice" ? `INV-${String(numValue).padStart(6,"0")}` : `QT-${String(numValue).padStart(6,"0")}`);
          const date = new Date();
          let dueDate = null;
          if (parsed.fields.due) {
            const d = new Date(parsed.fields.due);
            if (!isNaN(d)) dueDate = d;
            else {
              // try flexible parse (YYYY-MM-DD only is supported), else skip dueDate but log
              console.warn("TWILIO: invalid due date provided:", parsed.fields.due);
            }
          }
          const billingTo = parsed.fields.customer || parsed.fields.name || "";
          const email = parsed.fields.email || "";
          const items = Array.isArray(parsed.fields.items) ? parsed.fields.items : [];

          if (parsed.action === "invoice" && items.length === 0) {
            return sendTwimlText(res, "Invoice creation failed: no items provided. Use item:desc,qty,unit");
          }

          // Generate PDF
          try {
            const { filename } = await generatePDF({
              type,
              number: numberStr,
              date,
              dueDate,
              billingTo,
              email,
              items,
              notes: parsed.fields.notes || parsed.fields._text ? (Array.isArray(parsed.fields._text) ? parsed.fields._text.join(" | ") : parsed.fields._text) : ""
            });
            const site = (process.env.SITE_URL || "").replace(/\/$/, "");
            const baseForMedia = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
            const url = `${baseForMedia}/docs/generated/${type === "invoice" ? "invoices" : type === "quote" ? "quotes" : "receipts"}/${filename}`;
            return sendTwimlWithMedia(res, `${type[0].toUpperCase() + type.slice(1)} ${numberStr} created. Download: ${url}`, [url]);
          } catch (err) {
            console.error("TWILIO: pdf generation failed:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
            return sendTwimlText(res, "Failed to generate PDF; check logs.");
          }
        } else {
          return sendTwimlText(res, "Unknown admin command. Send 'hi' for usage.");
        }
      } catch (err) {
        console.error("TWILIO: admin command error:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
        return sendTwimlText(res, "Server error; try again later.");
      }
    } // end admin block

    // ---------- non-admin (existing behaviour) ----------
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

    const text = (bodyRaw || "").trim();
    const lctext = text.toLowerCase();

    // BASIC commands: greeting/help -> reply immediately
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

    // find command
    const words = lctext.split(/\s+/).filter(Boolean);
    if (words[0] === "find") {
      const city = words[1] || "Harare";
      const wantsBoarding = words.some((w) => /board|boarding/.test(w));
      const type2 = wantsBoarding ? ["Boarding"] : [];
      const curriculum = words.filter((w) => /cambridge|caie|zimsec|ib/.test(w));
      const facilities = [];

      // Build a plain object for lastPrefs
      const lastPrefs = {
        city: String(city),
        curriculum: Array.isArray(curriculum) ? curriculum.map(String) : toArraySafe(curriculum),
        learningEnvironment: undefined,
        schoolPhase: undefined,
        type2: Array.isArray(type2) ? type2.map(String) : toArraySafe(type2),
        facilities: [], // placeholder
      };

      // defensive logging so we can see exactly what gets written
      try {
        console.log("TWILIO: about to save lastPrefs (type check):", {
          providerId,
          lastPrefsType: typeof lastPrefs,
          lastPrefsIsArray: Array.isArray(lastPrefs),
          lastPrefsPreview: JSON.stringify(lastPrefs).slice(0, 1000)
        });

        await User.findOneAndUpdate(
          { provider: "whatsapp", providerId },
          { $set: { lastPrefs } }, // important: set to object (not array)
          { new: true, upsert: true }
        );
        console.log("TWILIO: lastPrefs saved for", providerId);
      } catch (e) {
        // make the error message fully visible in logs
        console.error("TWILIO: failed saving lastPrefs:", e && (e.stack || e.message) ? (e.stack || e.message) : e);
      };

      try {
        // Save as an object (not an array) to match your schema
        await User.findOneAndUpdate(
          { provider: "whatsapp", providerId },
          { $set: { lastPrefs } },
          { new: true, upsert: true }
        );
        console.log("TWILIO: lastPrefs saved for", providerId, lastPrefs);
      } catch (e) {
        console.error("TWILIO: failed saving lastPrefs:", e && e.message ? e.message : e);
      }

      // call recommend endpoint
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

        const lines = [`Top ${Math.min(5, recs.length)} matches for ${city}:`];
        for (const r of recs.slice(0, 5)) {
          lines.push(`\n• ${r.name}${r.city ? " — " + r.city : ""}`);
          if (r.curriculum) lines.push(`  Curriculum: ${Array.isArray(r.curriculum) ? r.curriculum.join(", ") : r.curriculum}`);
          if (r.fees) lines.push(`  Fees: ${r.fees}`);
          if (r.website) lines.push(`  Website: ${r.website}`);
          // Only show register link for St Eurit
          const name = (r.name || "").toLowerCase();
          if (/st[\s-]*eurit/.test(name) || (r.slug && /st-eurit/.test(r.slug))) {
            const registerUrl = "https://skoolfinder.net/register/st-eurit-international-school";
            if (registerUrl) lines.push(`  Register: ${registerUrl}`);
          }
        }
        lines.push("\nReply 'help' for commands.");
        return sendTwimlText(res, lines.join("\n"));
      } catch (e) {
        console.error("TWILIO: recommend call failed:", e && (e.message || (e.response && JSON.stringify(e.response.data))) ? (e.message || JSON.stringify(e.response.data)) : e);
        return sendTwimlText(res, "Search failed — please try again later.");
      }
    }

    // fav add
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
