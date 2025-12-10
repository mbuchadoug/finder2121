import express from "express";
import { Router } from "express";
import twilio from "twilio";
import fs from "fs";
import path from "path";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

let PDFDocument;
try {
  PDFDocument = await (async () => {
    try {
      return (await import("pdfkit")).default || (await import("pdfkit"));
    } catch (e) {
      try { /* fallback */ return require("pdfkit"); } catch (er) { return null; }
    }
  })();
} catch (e) {
  PDFDocument = null;
}

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

function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

function verifyTwilioRequest(req) {
  // allow either biz-specific debug flag or global debug flag
  if (process.env.DEBUG_TWILIO_BIZ_SKIP_VERIFY === "1" || process.env.DEBUG_TWILIO_SKIP_VERIFY === "1") {
    console.log("TWILIO_VERIFY (biz): DEBUG skip enabled");
    return true;
  }

  // prefer biz-specific auth token, fall back to the main one if not set
  const authToken = process.env.TWILIO_BIZ_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn("TWILIO_VERIFY (biz): TWILIO_BIZ_AUTH_TOKEN and TWILIO_AUTH_TOKEN not set — skipping verification (dev)");
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
        console.warn("TWILIO_VERIFY (biz): no host header; cannot verify");
        return false;
      }
      url = `${proto}://${host}${req.originalUrl}`;
    }
    const params = Object.assign({}, req.body || {});
    const ok = twilio.validateRequest(authToken, signature, url, params);
    if (!ok) console.warn("TWILIO_VERIFY (biz): signature invalid for", url, "signature:", signature);
    return ok;
  } catch (e) {
    console.warn("TWILIO_VERIFY (biz): error:", e?.message || e);
    return false;
  }
}

/* ---------- Counters (file) ---------- */
const DATA_DIR = path.join(process.cwd(), "data");
const COUNTER_FILE = path.join(DATA_DIR, "admin_counters.json");

async function ensureDataDir() {
  try { await fs.promises.mkdir(DATA_DIR, { recursive: true }); } catch (e) {}
}

async function loadCounters() {
  await ensureDataDir();
  try {
    const raw = await fs.promises.readFile(COUNTER_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    return { invoice: 0, quote: 0, receipt: 0 };
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

/* ---------- PDF generation (pdfkit) ---------- */
async function ensurePublicSubdirs() {
  const base = path.join(process.cwd(), "public", "docs", "generated");
  await fs.promises.mkdir(base, { recursive: true });
  for (const sub of ["invoices", "quotes", "receipts"]) {
    await fs.promises.mkdir(path.join(base, sub), { recursive: true });
  }
  return base;
}

function formatMoney(n) { return Number(n || 0).toFixed(2); }

function drawTable(doc, items, startX, startY, columnWidths) {
  const lineHeight = 18;
  let y = startY;
  doc.fontSize(10).fillColor("black");
  doc.text("Description", startX, y, { width: columnWidths[0] });
  doc.text("Qty", startX + columnWidths[0] + 10, y, { width: columnWidths[1], align: "right" });
  doc.text("Unit", startX + columnWidths[0] + 10 + columnWidths[1] + 10, y, { width: columnWidths[2], align: "right" });
  doc.text("Total", startX + columnWidths[0] + 10 + columnWidths[1] + 10 + columnWidths[2] + 10, y, { width: columnWidths[3], align: "right" });
  y += lineHeight;
  try {
    doc.moveTo(startX, y - 6).lineTo(startX + columnWidths.reduce((a,b) => a + b, 0) + 40, y - 6).strokeOpacity(0.08).stroke();
  } catch(e) {}
  for (const it of items) {
    doc.fontSize(10).fillColor("black");
    doc.text(it.description, startX, y, { width: columnWidths[0] });
    doc.text(String(it.qty), startX + columnWidths[0] + 10, y, { width: columnWidths[1], align: "right" });
    doc.text(formatMoney(it.unit), startX + columnWidths[0] + 10 + columnWidths[1] + 10, y, { width: columnWidths[2], align: "right" });
    doc.text(formatMoney((it.qty||0) * (it.unit||0)), startX + columnWidths[0] + 10 + columnWidths[1] + 10 + columnWidths[2] + 10, y, { width: columnWidths[3], align: "right" });
    y += lineHeight;
  }
  return y;
}

async function generatePDF({ type, number, date, dueDate, billingTo, email, items = [], notes = "" }) {
  if (!PDFDocument) throw new Error("pdfkit not available. Install with: npm install pdfkit");

  const baseDir = await ensurePublicSubdirs();
  const folder = path.join(baseDir, type === "invoice" ? "invoices" : type === "quote" ? "quotes" : "receipts");
  const filename = `${type}-${number}-${Date.now()}.pdf`;
  const filepath = path.join(folder, filename);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      const logoPath = path.join(process.cwd(), "public", "docs", "logo.png");
      if (fs.existsSync(logoPath)) {
        try { doc.image(logoPath, 50, 45, { width: 90 }); } catch (e) {}
      }
      doc.fontSize(20).fillColor("#111").text(type === "invoice" ? "INVOICE" : type === "quote" ? "QUOTATION" : "RECEIPT", 400, 50, { align: "right" });
      doc.fontSize(10).fillColor("#333").text(`No: ${number}`, 400, 75, { align: "right" });
      doc.text(`Date: ${date.toISOString().slice(0,10)}`, 400, 90, { align: "right" });
      if (dueDate) doc.text(`Due: ${dueDate.toISOString().slice(0,10)}`, 400, 105, { align: "right" });

      doc.moveDown(2);
      doc.fontSize(12).fillColor("#000").text("Bill To:", 50, 140);
      doc.fontSize(11).fillColor("#111").text(billingTo || "-", 50, 155);
      if (email) doc.fontSize(10).fillColor("#666").text(email, 50, 170);

      const startY = 210;
      const columnWidths = [260, 60, 80, 80];
      const afterTableY = drawTable(doc, items, 50, startY, columnWidths);

      let subtotal = items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit||0)), 0);
      const tax = 0;
      const total = subtotal + tax;
      doc.fontSize(10).fillColor("#111").text(`Subtotal: ${formatMoney(subtotal)}`, 400, afterTableY + 10, { align: "right" });
      if (tax) doc.text(`Tax: ${formatMoney(tax)}`, 400, afterTableY + 25, { align: "right" });
      doc.fontSize(12).fillColor("#000").text(`Total: ${formatMoney(total)}`, 400, afterTableY + 40, { align: "right" });

      if (notes) {
        doc.moveDown(2);
        doc.fontSize(10).fillColor("#333").text("Notes:", 50, afterTableY + 80);
        doc.fontSize(9).fillColor("#444").text(notes, 50, afterTableY + 95, { width: 400 });
      }

      doc.fontSize(9).fillColor("gray").text("-----------", 50, 760, { align: "center", width: 500 });

      doc.end();
      stream.on("finish", () => resolve({ filepath, filename }));
      stream.on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

/* ---------- Admin command parsing ---------- */
function parseAdminCommand(bodyRaw) {
  const parts = bodyRaw.split("|").map(p => p.trim()).filter(Boolean);
  const command = parts.shift() || "";
  const cmdWords = command.split(/\s+/).filter(Boolean);
  const action = (cmdWords[0] || "").toLowerCase();
  const verb = (cmdWords[1] || "").toLowerCase();
  const result = { raw: bodyRaw, action, verb, fields: {} };

  for (const p of parts) {
    const idx = p.indexOf(":");
    if (idx === -1) {
      if (!result.fields._text) result.fields._text = [];
      result.fields._text.push(p);
      continue;
    }
    const key = p.slice(0, idx).trim().toLowerCase();
    const val = p.slice(idx + 1).trim();
    if (key === "item") {
      if (!result.fields.items) result.fields.items = [];
      const itemParts = val.split(",").map(x => x.trim());
      const description = itemParts[0] || "";
      const qty = Number(itemParts[1] || 1);
      const unit = Number(itemParts[2] || 0);
      result.fields.items.push({ description, qty, unit });
    } else {
      result.fields[key] = val;
    }
  }
  return result;
}

/* Robust date parser that normalizes weird hyphens and whitespace */
function parseDateFlexible(s) {
  if (!s) return null;
  // convert any unicode dash to normal hyphen, remove non-printable
  const norm = String(s).replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-").replace(/[^\x20-\x7E\-:]/g, "").trim();
  // supported formats: YYYY-MM-DD, YYYYMMDD, DD-MM-YYYY, ISO fallback
  if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) {
    const d = new Date(norm);
    if (!isNaN(d)) return d;
  }
  if (/^\d{8}$/.test(norm)) {
    const y = norm.slice(0,4), m = norm.slice(4,6), d = norm.slice(6,8);
    const dt = new Date(`${y}-${m}-${d}`);
    if (!isNaN(dt)) return dt;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(norm)) {
    const [dd,mm,yy] = norm.split("-");
    const dt = new Date(`${yy}-${mm}-${dd}`);
    if (!isNaN(dt)) return dt;
  }
  // try Date parser
  const dt = new Date(norm);
  if (!isNaN(dt)) return dt;
  return null;
}

/* ---------- Main webhook (admin-only, any phone) ---------- */
router.post("/webhook", async (req, res) => {
  console.log("TWILIO (biz): webhook hit ->", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
  console.log("TWILIO (biz): debug env:", {
    SITE_URL: process.env.SITE_URL ? "[set]" : "[missing]",
    DEBUG_TWILIO_BIZ_SKIP_VERIFY: process.env.DEBUG_TWILIO_BIZ_SKIP_VERIFY || "[not set]",
    DEBUG_TWILIO_SKIP_VERIFY: process.env.DEBUG_TWILIO_SKIP_VERIFY || "[not set]",
    TWILIO_BIZ_AUTH_TOKEN: process.env.TWILIO_BIZ_AUTH_TOKEN ? "[set]" : "[missing]",
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? "[set]" : "[missing]"
  });

  try { console.log("TWILIO (biz): body (raw):", JSON.stringify(req.body)); } catch (e) { console.log("TWILIO (biz): body (raw) - keys:", Object.keys(req.body || {})); }

  const ok = verifyTwilioRequest(req);
  if (!ok) {
    res.status(403);
    return sendTwimlText(res, "Invalid Twilio signature");
  }

  try {
    const params = req.body || {};
    const rawFrom = String(params.From || params.from || "");
    const bodyRaw = String(params.Body || params.body || "").trim();
    const profileName = String(params.ProfileName || params.profileName || "");
    console.log("TWILIO (biz): parsed", { rawFrom, bodyRaw, profileName });

    if (!rawFrom) return sendTwimlText(res, "Missing sender info");

    const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();
    const providerIdNormalized = normalizePhone(providerId);

    // NOTE: per request - allow any phone number to access admin webhook
    console.log("TWILIO (biz): treating", providerId, "as admin (open admin access)");

    // Admin block (same logic as before)
    const trimmed = (bodyRaw || "").trim();
    const lctext = trimmed.toLowerCase();
    if (!lctext || ["hi","hello","hey"].includes(lctext)) {
      const help = `Admin commands:
invoice create|customer:Name|email:em@ill|item:Desc,qty,unit|item:Desc,qty,unit|due:YYYY-MM-DD|notes:...
quote create|customer:Name|email:em@ill|item:Desc,qty,unit|...
receipt create|amount:100|description:Payment|customer:Name|email:...`;
      return sendTwimlText(res, help);
    }

    const parsed = parseAdminCommand(bodyRaw);
    try {
      if (!parsed.action || !parsed.verb) {
        return sendTwimlText(res, "Invalid admin command. Send 'hi' for usage.");
      }

      if (["invoice","quote","receipt"].includes(parsed.action) && parsed.verb === "create") {
        if (!PDFDocument) {
          console.error("TWILIO (biz): pdfkit not installed; cannot create PDF");
          return sendTwimlText(res, "PDF generation is not available: please `npm install pdfkit` on the server.");
        }

        if (parsed.action === "receipt") {
          const amount = Number(parsed.fields.amount || parsed.fields.total || 0);
          if (isNaN(amount) || amount <= 0) {
            return sendTwimlText(res, "Receipt creation failed: invalid or missing amount. Use amount:100");
          }
          const num = await incrementCounter("receipt");
          const numberStr = `R-${String(num).padStart(6, "0")}`;
          const date = new Date();
          const billingTo = parsed.fields.customer || parsed.fields.name || "";
          const email = parsed.fields.email || "";
          const items = [{ description: parsed.fields.description || "Payment", qty: 1, unit: amount }];

          try {
            const { filename } = await generatePDF({ type: "receipt", number: numberStr, date, dueDate: null, billingTo, email, items, notes: parsed.fields.notes || "" });
            const site = (process.env.SITE_URL || "").replace(/\/$/, "");
            const baseForMedia = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
            const url = `${baseForMedia}/docs/generated/receipts/${filename}`;
            return sendTwimlWithMedia(res, `Receipt ${numberStr} created. Download: ${url}`, [url]);
          } catch (err) {
            console.error("TWILIO (biz): receipt pdf generation failed:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
            return sendTwimlText(res, "Failed to generate receipt PDF; check server logs.");
          }
        }

        // invoice / quote
        const type = parsed.action === "invoice" ? "invoice" : "quote";
        const numValue = await incrementCounter(type);
        const numberStr = (type === "invoice" ? `INV-${String(numValue).padStart(6,"0")}` : `QT-${String(numValue).padStart(6,"0")}`);
        const date = new Date();

        let dueDate = null;
        if (parsed.fields.due) {
          const maybe = parseDateFlexible(parsed.fields.due);
          if (maybe) dueDate = maybe;
          else {
            console.warn("TWILIO (biz): invalid due date provided:", parsed.fields.due);
          }
        }

        const billingTo = parsed.fields.customer || parsed.fields.name || "";
        const email = parsed.fields.email || "";
        const items = Array.isArray(parsed.fields.items) ? parsed.fields.items : [];

        if (parsed.action === "invoice" && items.length === 0) {
          return sendTwimlText(res, "Invoice creation failed: no items provided. Use item:desc,qty,unit");
        }

        try {
          const notes = parsed.fields.notes || (parsed.fields._text ? (Array.isArray(parsed.fields._text) ? parsed.fields._text.join(" | ") : parsed.fields._text) : "");
          const fullNotes = (dueDate ? notes : `${notes}${notes ? " | " : ""}NOTE: due date invalid or missing, please check.`);
          const { filename } = await generatePDF({ type, number: numberStr, date, dueDate, billingTo, email, items, notes: fullNotes });
          const site = (process.env.SITE_URL || "").replace(/\/$/, "");
          const baseForMedia = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
          const url = `${baseForMedia}/docs/generated/${type === "invoice" ? "invoices" : "quotes"}/${filename}`;
          return sendTwimlWithMedia(res, `${type[0].toUpperCase() + type.slice(1)} ${numberStr} created. Download: ${url}`, [url]);
        } catch (err) {
          console.error("TWILIO (biz): pdf generation failed:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
          return sendTwimlText(res, "Failed to generate PDF; check server logs.");
        }
      } else {
        return sendTwimlText(res, "Unknown admin command. Send 'hi' for usage.");
      }
    } catch (err) {
      console.error("TWILIO (biz): admin command error:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
      return sendTwimlText(res, "Server error; try again later.");
    }

  } catch (err) {
    console.error("TWILIO (biz): webhook handler error:", err && err.stack ? err.stack : err);
    try { return sendTwimlText(res, "Server error; try again later."); } catch (e) { return res.status(500).end(); }
  }
});

export default router;
