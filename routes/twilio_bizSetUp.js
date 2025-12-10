// routes/twilio_biz.js
import express from "express";
import { Router } from "express";
import twilio from "twilio";
import fs from "fs";
import path from "path";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

import Business from "../models/business.js";
import Client from "../models/client.js";

let PDFDocument;
try {
  PDFDocument = await (async () => {
    try {
      return (await import("pdfkit")).default || (await import("pdfkit"));
    } catch (e) {
      try { /* fallback for commonjs env */ return require("pdfkit"); } catch (er) { return null; }
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

/* verification: prefer TWILIO_BIZ_AUTH_TOKEN, fallback to TWILIO_AUTH_TOKEN */
function verifyTwilioRequest(req) {
  if (process.env.DEBUG_TWILIO_BIZ_SKIP_VERIFY === "1" || process.env.DEBUG_TWILIO_SKIP_VERIFY === "1") {
    console.log("TWILIO_VERIFY (biz): DEBUG skip enabled");
    return true;
  }
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

/* ---------- Simple command parser (kept for admin commands if needed) ---------- */
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
  const norm = String(s).replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-").replace(/[^\x20-\x7E\-:]/g, "").trim();
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
  const dt = new Date(norm);
  if (!isNaN(dt)) return dt;
  return null;
}

/* ---------- Stateful onboarding + invoice flows helpers ---------- */

async function ensureLogosDir() {
  const logosDir = path.join(process.cwd(), "public", "docs", "logos");
  try { await fs.promises.mkdir(logosDir, { recursive: true }); } catch (e) {}
  return logosDir;
}

async function saveLogoFromTwilio(mediaUrl, businessId) {
  if (!mediaUrl) throw new Error("No media URL");
  const logosDir = await ensureLogosDir();
  const filename = `logo-${businessId}.png`;
  const filepath = path.join(logosDir, filename);
  const resp = await axios.get(mediaUrl, { responseType: "arraybuffer", timeout: 15000 });
  await fs.promises.writeFile(filepath, resp.data);
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const publicUrl = site ? `${site}/docs/logos/${filename}` : `/docs/logos/${filename}`;
  return { filepath, filename, publicUrl };
}

function resetSession(biz) {
  biz.sessionState = null;
  biz.sessionData = {};
  return biz.save();
}

function sendMenu(res) {
  const msg = `ZimQuote — reply with a number:
1) Create business account
2) New invoice
3) Add client
4) Upload logo
5) Settings
6) Help`;
  return sendTwimlText(res, msg);
}

/* ---------- Main stateful webhook for biz (admin-style, any phone treated as business) ---------- */
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
    const rawFrom = String(params.From || params.from || "").trim();
    const bodyRaw = String(params.Body || params.body || "").trim();
    const profileName = String(params.ProfileName || params.profileName || "");
    if (!rawFrom) return sendTwimlText(res, "Missing sender info");

    const providerId = rawFrom.replace(/^whatsapp:/i, "").trim();

    // find or create business record by phone
    let biz = await Business.findOne({ provider: "whatsapp", providerId });
    if (!biz) {
      biz = await Business.create({ provider: "whatsapp", providerId, name: null, sessionState: null, sessionData: {}, counters: { invoice: 0, quote: 0, receipt: 0 } });
      console.log("TWILIO (biz): created business record", biz._id?.toString());
    }

    if (profileName && !biz.name) {
      biz.name = biz.name || profileName;
      await biz.save().catch(() => {});
    }

    const text = bodyRaw || "";
    const lctext = (text || "").toLowerCase();

    // always allow 'menu' or '0' to reset and show menu
    if (["menu", "0"].includes(lctext)) {
      await resetSession(biz);
      return sendMenu(res);
    }

    // if business not yet set up (no name) and no session, start onboarding
    if (!biz.name && !biz.sessionState) {
      const welcome = `Welcome to ZimQuote 👋\nQuick setup:\n1) Create business account\n2) Try demo (create sample invoice)\n3) Help\n\nReply with the number to proceed.`;
      biz.sessionState = "awaiting_first_choice";
      await biz.save();
      return sendTwimlText(res, welcome);
    }

    // handle session-based flows
    const state = biz.sessionState || "idle";

    // handle main menu numeric choices when idle/awaiting_first_choice
    if (!state || state === "idle" || state === "awaiting_first_choice") {
      const num = (text || "").trim();
      if (num === "1") {
        biz.sessionState = "awaiting_business_name";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, "Great — what's your business name? (e.g. 'ABC Traders')");
      }
      if (num === "2") {
        // demo invoice
        const demoClient = { name: "Demo Client", phone: providerId };
        const items = [{ description: "Demo service", qty: 1, unit: 100 }];
        // increment biz counter
        biz.counters = biz.counters || { invoice: 0, quote: 0, receipt: 0 };
        biz.counters.invoice = (biz.counters.invoice || 0) + 1;
        const numberStr = `${biz.invoicePrefix || "INV"}-${String(biz.counters.invoice).padStart(6,"0")}`;
        const date = new Date();
        try {
          const { filename } = await generatePDF({ type: "invoice", number: numberStr, date, dueDate: null, billingTo: demoClient.name, email: "", items, notes: "Demo invoice" });
          await biz.save();
          const site = (process.env.SITE_URL || "").replace(/\/$/, "");
          const baseForMedia = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
          const url = `${baseForMedia}/docs/generated/invoices/${filename}`;
          return sendTwimlWithMedia(res, `Demo invoice created. Download: ${url}`, [url]);
        } catch (err) {
          console.error("TWILIO (biz): demo invoice failed", err);
          return sendTwimlText(res, "Demo generation failed on server; check logs.");
        }
      }
      if (num === "3" || lctext === "help") {
        return sendTwimlText(res, `Help — quick commands:\n1) Create business account\n2) New invoice\n3) Add client\n4) Upload logo\nReply with the number to proceed.`);
      }
      if (num === "4") {
        biz.sessionState = "awaiting_logo_upload";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, "Please send your business logo (as an image). Reply '1' to skip.");
      }
      if (num === "2" && biz.name) { /* fallback: if biz exists and user typed 2 earlier handled above */ }

      return sendMenu(res);
    }

    // ---------- ONBOARDING STATES ----------
    if (state === "awaiting_business_name") {
      const name = text.trim();
      if (!name) return sendTwimlText(res, "Please send a business name (e.g. 'ABC Traders').");
      biz.name = name;
      biz.sessionState = "awaiting_logo_choice";
      await biz.save();
      return sendTwimlText(res, `Thanks — "${name}".\nNow send your logo image, or reply:\n1) Skip logo\n2) Add later`);
    }

    if (state === "awaiting_logo_choice") {
      if (text.trim() === "1") {
        biz.sessionState = "awaiting_currency";
        await biz.save();
        return sendTwimlText(res, `Logo skipped. What currency do you want to use? (ZWL, USD, ZAR) — reply e.g. 'ZWL'`);
      }
      if (text.trim() === "2") {
        biz.sessionState = "ready";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, `Setup finished. Use 'menu' to see commands. Quick commands:\n1) New invoice\n2) Add client\n3) Upload logo`);
      }
      return sendTwimlText(res, `Send an image file for your logo, or reply:\n1) Skip logo\n2) Add later`);
    }

    if (state === "awaiting_currency") {
      const cur = (text || "").trim().toUpperCase();
      if (!["ZWL", "USD", "ZAR"].includes(cur)) {
        biz.sessionState = "awaiting_currency";
        await biz.save();
        return sendTwimlText(res, "Invalid currency. Reply with one of: ZWL, USD, ZAR");
      }
      biz.currency = cur;
      biz.sessionState = "ready";
      await biz.save();
      return sendTwimlText(res, `All set! Business "${biz.name}" created with currency ${cur}.\nReply 'menu' or '1' for New invoice.`);
    }

    // ---------- LOGO UPLOAD (media) ----------
    const mediaCount = Number(params.NumMedia || params.MediaCount || 0);
    if ((state === "awaiting_logo_upload" || state === "awaiting_logo_choice") && mediaCount > 0) {
      const mediaUrl0 = params.MediaUrl0 || params.mediaUrl0;
      try {
        const saved = await saveLogoFromTwilio(mediaUrl0, biz._id.toString());
        biz.logoUrl = saved.publicUrl;
        biz.sessionState = "awaiting_currency";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, `Logo received and saved. Next: what currency do you want to use? Reply: ZWL / USD / ZAR`);
      } catch (e) {
        console.error("TWILIO (biz): logo save failed", e);
        return sendTwimlText(res, "Could not save logo — please send a JPG/PNG image or reply '1' to skip.");
      }
    }

    // ---------- ADD CLIENT / INVOICE FLOW ----------
    if (state === "creating_invoice_choose_client") {
      const choice = text.trim();
      if (choice === "1") {
        const clients = await Client.find({ businessId: biz._id }).sort({ updatedAt: -1 }).limit(5).lean();
        if (!clients.length) {
          biz.sessionState = "creating_invoice_new_client";
          await biz.save();
          return sendTwimlText(res, "No saved clients. Please enter client name:");
        }
        let lines = ["Choose a client by number:"];
        clients.forEach((c, i) => lines.push(`${i+1}) ${c.name || c.phone} ${c.phone ? "- " + c.phone : ""}`));
        lines.push(`${clients.length+1}) New client`);
        biz.sessionState = "creating_invoice_choose_client_index";
        biz.sessionData.recentClients = clients;
        await biz.save();
        return sendTwimlText(res, lines.join("\n"));
      } else if (choice === "2") {
        biz.sessionState = "creating_invoice_new_client";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, "Client name?");
      } else {
        await resetSession(biz);
        return sendTwimlText(res, "Cancelled. Reply 'menu' to start again.");
      }
    }

    if (state === "creating_invoice_choose_client_index") {
      const idx = Number(text.trim());
      const clients = biz.sessionData.recentClients || [];
      if (!idx || idx < 1 || idx > clients.length + 1) {
        return sendTwimlText(res, "Invalid selection. Reply the client number or choose 'New client'.");
      }
      if (idx === clients.length + 1) {
        biz.sessionState = "creating_invoice_new_client";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, "Client name?");
      }
      const client = clients[idx-1];
      biz.sessionData.client = client;
      biz.sessionState = "creating_invoice_add_items";
      await biz.save();
      return sendTwimlText(res, `Client set to ${client.name || client.phone}. Now add item:\nSend item description (e.g. 'Website design')`);
    }

    if (state === "creating_invoice_new_client") {
      if (!biz.sessionData.clientName && text.trim()) {
        const cname = text.trim();
        biz.sessionData.clientName = cname;
        biz.sessionState = "creating_invoice_new_client_phone";
        await biz.save();
        return sendTwimlText(res, "Client phone? (e.g. +263772123456) or reply 'same' to use this sender");
      }
    }

    if (state === "creating_invoice_new_client_phone") {
      const phoneRaw = text.trim();
      const phone = phoneRaw.toLowerCase() === "same" ? providerId : phoneRaw;
      const client = await Client.findOneAndUpdate(
        { businessId: biz._id, phone },
        { $set: { name: biz.sessionData.clientName, phone } },
        { new: true, upsert: true }
      );
      biz.sessionData.client = client;
      biz.sessionData.items = [];
      biz.sessionState = "creating_invoice_add_items";
      await biz.save();
      return sendTwimlText(res, `Client saved: ${client.name} (${client.phone}).\nNow send item description (e.g. 'Website design')`);
    }

    // items loop
    if (state === "creating_invoice_add_items") {
      // non-numeric flows: description -> qty -> unit
      if (!biz.sessionData.awaitingItemDesc) {
        const desc = text.trim();
        if (!desc) return sendTwimlText(res, "Send an item description (or reply 'done' to finish).");
        biz.sessionData.awaitingItemDesc = true;
        biz.sessionData.lastItem = { description: desc };
        await biz.save();
        return sendTwimlText(res, "Qty? (e.g. 1)");
      } else if (biz.sessionData.awaitingItemDesc && !biz.sessionData.lastItem.qty) {
        const qty = Number(text.trim());
        if (isNaN(qty) || qty <= 0) return sendTwimlText(res, "Invalid qty. Enter a number like '1'.");
        biz.sessionData.lastItem.qty = qty;
        await biz.save();
        return sendTwimlText(res, "Unit price? (e.g. 450)");
      } else if (biz.sessionData.lastItem && biz.sessionData.lastItem.qty && !biz.sessionData.lastItem.unit) {
        const unit = Number(text.trim());
        if (isNaN(unit)) return sendTwimlText(res, "Invalid price. Enter a number like '450'.");
        biz.sessionData.lastItem.unit = unit;
        biz.sessionData.items = biz.sessionData.items || [];
        biz.sessionData.items.push(biz.sessionData.lastItem);
        biz.sessionData.lastItem = null;
        biz.sessionData.awaitingItemDesc = false;
        await biz.save();
        return sendTwimlText(res, `Item added. Total items: ${biz.sessionData.items.length}\nReply:\n1) Add another item\n2) Done (generate invoice)\n3) Cancel`);
      }
      // also handle numeric choices while in items state:
      if (["1","2","3"].includes(text.trim())) {
        const choice = text.trim();
        if (choice === "1") return sendTwimlText(res, "Send next item description:");
        if (choice === "2") {
          const items = biz.sessionData.items || [];
          if (!items.length) return sendTwimlText(res, "No items added. Add an item first.");
          const subtotal = items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit||0)), 0);
          let summary = `Invoice summary for ${biz.sessionData.client.name || biz.sessionData.client.phone}:\n`;
          items.forEach((it, i) => summary += `${i+1}) ${it.description} x${it.qty} @ ${formatMoney(it.unit)} = ${formatMoney((it.qty||0)*(it.unit||0))}\n`);
          summary += `Subtotal: ${formatMoney(subtotal)} ${biz.currency || "ZWL"}\n\n1) Send & generate PDF\n2) Save as draft\n3) Cancel`;
          biz.sessionState = "creating_invoice_confirm";
          await biz.save();
          return sendTwimlText(res, summary);
        }
        if (choice === "3") {
          await resetSession(biz);
          return sendTwimlText(res, "Invoice creation cancelled.");
        }
      }
    }

    if (state === "creating_invoice_confirm") {
      if (text.trim() === "1") {
        const items = biz.sessionData.items || [];
        const client = biz.sessionData.client;
        biz.counters = biz.counters || { invoice: 0, quote: 0, receipt: 0 };
        biz.counters.invoice = (biz.counters.invoice || 0) + 1;
        const numberStr = `${biz.invoicePrefix || "INV"}-${String(biz.counters.invoice).padStart(6, "0")}`;
        const date = new Date();
        try {
          const { filename } = await generatePDF({ type: "invoice", number: numberStr, date, dueDate: null, billingTo: client.name || client.phone, email: client.email || "", items, notes: "" });
          await biz.save();
          const site = (process.env.SITE_URL || "").replace(/\/$/, "");
          const baseForMedia = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
          const url = `${baseForMedia}/docs/generated/invoices/${filename}`;
          await resetSession(biz);
          return sendTwimlWithMedia(res, `Invoice ${numberStr} created. Download: ${url}`, [url]);
        } catch (e) {
          console.error("TWILIO (biz): invoice PDF failed", e);
          return sendTwimlText(res, "Failed to generate invoice PDF; check server logs.");
        }
      } else if (text.trim() === "2") {
        biz.sessionState = "ready";
        await biz.save();
        return sendTwimlText(res, "Saved invoice as draft. Reply 'menu' to continue.");
      } else {
        await resetSession(biz);
        return sendTwimlText(res, "Cancelled.");
      }
    }

    // fallback
    return sendMenu(res);

  } catch (err) {
    console.error("TWILIO (biz): webhook handler error:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
    try { return sendTwimlText(res, "Server error; try again later."); } catch (e) { return res.status(500).end(); }
  }
});

export default router;
