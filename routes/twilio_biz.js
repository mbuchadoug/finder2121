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
      try { return require("pdfkit"); } catch (er) { return null; }
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

function formatMoney(n) { return Number(n || 0).toFixed(2); }

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

/* ---------- File counters (fallback) ---------- */
const DATA_DIR = path.join(process.cwd(), "data");
const COUNTER_FILE = path.join(DATA_DIR, "admin_counters.json");
async function ensureDataDir() { try { await fs.promises.mkdir(DATA_DIR, { recursive: true }); } catch (e) {} }
async function loadCounters() {
  await ensureDataDir();
  try { const raw = await fs.promises.readFile(COUNTER_FILE, "utf8"); return JSON.parse(raw || "{}"); } catch (e) { return { invoice: 0, quote: 0, receipt: 0 }; }
}
async function saveCounters(obj) { await ensureDataDir(); await fs.promises.writeFile(COUNTER_FILE, JSON.stringify(obj, null, 2), "utf8"); }
async function incrementCounter(type) { const counters = await loadCounters(); if (!counters[type]) counters[type] = 0; counters[type] = Number(counters[type]) + 1; await saveCounters(counters); return counters[type]; }

/* ---------- PDF helpers (keeps your generatePDF) ---------- */
async function ensurePublicSubdirs() {
  const base = path.join(process.cwd(), "public", "docs", "generated");
  await fs.promises.mkdir(base, { recursive: true });
  for (const sub of ["invoices", "quotes", "receipts"]) {
    await fs.promises.mkdir(path.join(base, sub), { recursive: true });
  }
  return base;
}

function drawTable(doc, items, startX, startY, columnWidths) {
  const lineHeight = 18;
  let y = startY;
  doc.fontSize(10).fillColor("black");
  doc.text("Description", startX, y, { width: columnWidths[0] });
  doc.text("Qty", startX + columnWidths[0] + 10, y, { width: columnWidths[1], align: "right" });
  doc.text("Unit", startX + columnWidths[0] + 10 + columnWidths[1] + 10, y, { width: columnWidths[2], align: "right" });
  doc.text("Total", startX + columnWidths[0] + 10 + columnWidths[1] + 10 + columnWidths[2] + 10, y, { width: columnWidths[3], align: "right" });
  y += lineHeight;
  try { doc.moveTo(startX, y - 6).lineTo(startX + columnWidths.reduce((a,b) => a + b, 0) + 40, y - 6).strokeOpacity(0.08).stroke(); } catch(e) {}
  for (const it of items) {
    doc.fontSize(10).fillColor("black");
    doc.text(it.description, startX, y, { width: columnWidths[0] });
    doc.text(String(it.qty), startX + columnWidths[0] + 10, y, { width: columnWidths[1], align: "right" });
    doc.text(formatMoney(it.unit || 0), startX + columnWidths[0] + 10 + columnWidths[1] + 10, y, { width: columnWidths[2], align: "right" });
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
      if (fs.existsSync(logoPath)) { try { doc.image(logoPath, 50, 45, { width: 90 }); } catch (e) {} }
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
      if (notes) { doc.moveDown(2); doc.fontSize(10).fillColor("#333").text("Notes:", 50, afterTableY + 80); doc.fontSize(9).fillColor("#444").text(notes, 50, afterTableY + 95, { width: 400 }); }
      doc.fontSize(9).fillColor("gray").text("-----------", 50, 760, { align: "center", width: 500 });
      doc.end();
      stream.on("finish", () => resolve({ filepath, filename }));
      stream.on("error", (err) => reject(err));
    } catch (err) { reject(err); }
  });
}

/* ---------- Logo saving helpers ---------- */
async function ensureLogosDir() { const logosDir = path.join(process.cwd(), "public", "docs", "logos"); try { await fs.promises.mkdir(logosDir, { recursive: true }); } catch (e) {} return logosDir; }
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

async function resetSession(biz) { biz.sessionState = null; biz.sessionData = {}; return biz.save(); }

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

/* ---------- Main webhook (numbers-only commands) ---------- */
router.post("/webhook", async (req, res) => {
  console.log("TWILIO (biz): webhook hit ->", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
  try { console.log("TWILIO (biz): body (raw):", JSON.stringify(req.body)); } catch (e) { console.log("TWILIO (biz): body keys:", Object.keys(req.body || {})); }

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

    // find or create business (one number => one business)
    let biz = await Business.findOne({ provider: "whatsapp", providerId });
    if (!biz) {
      biz = await Business.create({
        provider: "whatsapp",
        providerId,
        name: null,
        sessionState: null,
        sessionData: {},
        counters: { invoice: 0, quote: 0, receipt: 0 },
        currency: "ZWL",
        invoicePrefix: "INV",
        quotePrefix: "QT",
        paymentTermsDays: 30
      });
      console.log("TWILIO (biz): created business record", biz._id?.toString());
    }

    if (profileName && !biz.name) {
      biz.name = biz.name || profileName;
      await biz.save().catch(() => {});
    }

    const text = bodyRaw || "";
    const trimmed = text.trim();

    // Always allow 'menu' or '0' to show main menu and reset session
    if (trimmed.toLowerCase() === "menu" || trimmed === "0") {
      await resetSession(biz);
      return sendMenu(res);
    }

    // If biz not named and no session, start onboarding prompt
    if (!biz.name && !biz.sessionState) {
      biz.sessionState = "awaiting_first_choice";
      await biz.save();
      return sendTwimlText(res, `Welcome to ZimQuote 👋\nQuick setup:\n1) Create business account\n2) Try demo\n3) Help\nReply with a number.`);
    }

    // TOP-LEVEL: Strictly accept only numeric single-digit commands for main menu
    const isSingleNumber = /^\d+$/.test(trimmed);
    const state = biz.sessionState || "idle";

    // DEBUG LOG: shows incoming trimmed text and state (remove later if desired)
    console.log("TWILIO (biz): incoming trimmed:", JSON.stringify(trimmed), "sessionState:", state, "isSingleNumber:", isSingleNumber);

    // Accept numeric top-level commands when state is idle, awaiting_first_choice OR ready.
    if ((state === "idle" || state === "awaiting_first_choice" || state === "ready") && isSingleNumber) {
      const num = trimmed;
      // 1 - Create business
      if (num === "1") {
        if (biz.name) return sendTwimlText(res, `You already have a business: "${biz.name}". Reply 5 for settings.`);
        biz.sessionState = "awaiting_business_name";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, "Great — what's your business name? (e.g. 'ABC Traders')");
      }
      // 2 - New invoice
      if (num === "2") {
        if (!biz.name) {
          biz.sessionState = "awaiting_first_choice"; await biz.save();
          return sendTwimlText(res, "You need to create a business first. Reply 1 to create.");
        }
        biz.sessionState = "creating_invoice_choose_client";
        biz.sessionData = { items: [] };
        biz.markModified('sessionData');
        await biz.save();
        return sendTwimlText(res, "Create Invoice — pick option:\n1) Use saved client\n2) New client\n3) Cancel");
      }
      // 3 - Add client
      if (num === "3") {
        if (!biz.name) { biz.sessionState = "awaiting_first_choice"; await biz.save(); return sendTwimlText(res, "You need to create a business first. Reply 1 to create."); }
        biz.sessionState = "adding_client_name";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, "Adding client — what's the client name?");
      }
      // 4 - Upload logo
      if (num === "4") {
        biz.sessionState = "awaiting_logo_upload";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, "Please send your business logo (as an image). Reply 1 to skip.");
      }
      // 5 - Settings
      if (num === "5") {
        biz.sessionState = "settings_menu";
        await biz.save();
        const sMsg = `Settings for ${biz.name || "(unnamed)"}:
1) Currency (current: ${biz.currency || "ZWL"})
2) Payment terms days (current: ${biz.paymentTermsDays || 30})
3) Invoice prefix (current: ${biz.invoicePrefix || "INV"})
4) Quote prefix (current: ${biz.quotePrefix || "QT"})
5) Change logo
6) View clients
0) Back to menu
Reply with number to edit.`;
        return sendTwimlText(res, sMsg);
      }
      // 6 - Help
      if (num === "6") {
        return sendTwimlText(res, `Help — reply with numbers only:
1) Create business account
2) New invoice
3) Add client
4) Upload logo
5) Settings
6) Help
Type 'menu' to return here anytime.`);
      }

      // unknown number
      return sendMenu(res);
    }

    // Onboarding and simple states
    if (state === "awaiting_business_name") {
      const name = trimmed;
      if (!name) return sendTwimlText(res, "Please send a business name (e.g. 'ABC Traders').");
      biz.name = name;
      biz.sessionState = "awaiting_logo_choice";
      await biz.save();
      return sendTwimlText(res, `Thanks — "${name}".\nSend your logo image now, or reply 1 to skip, 2 to add later.`);
    }

    if (state === "awaiting_logo_choice") {
      if (trimmed === "1") { biz.sessionState = "awaiting_currency"; await biz.save(); return sendTwimlText(res, `Logo skipped. What currency do you want? (ZWL, USD, ZAR)`); }
      if (trimmed === "2") { biz.sessionState = "ready"; biz.sessionData = {}; await biz.save(); return sendTwimlText(res, `Setup finished. Reply menu to see commands.`); }
      return sendTwimlText(res, `Send an image file for your logo, or reply 1 to skip, 2 to add later.`);
    }

    if (state === "awaiting_currency") {
      const cur = trimmed.toUpperCase();
      if (!["ZWL","USD","ZAR"].includes(cur)) { biz.sessionState = "awaiting_currency"; await biz.save(); return sendTwimlText(res, "Invalid currency. Reply ZWL, USD or ZAR."); }
      biz.currency = cur; biz.sessionState = "ready"; await biz.save();
      return sendTwimlText(res, `All set! Business "${biz.name}" created with currency ${cur}. Reply 'menu' or 2 for New invoice.`);
    }

    // Logo upload (media)
    const mediaCount = Number(params.NumMedia || params.MediaCount || 0);
    if ((state === "awaiting_logo_upload" || state === "awaiting_logo_choice") && mediaCount > 0) {
      const mediaUrl0 = params.MediaUrl0 || params.mediaUrl0;
      try {
        const saved = await saveLogoFromTwilio(mediaUrl0, biz._id.toString());
        biz.logoUrl = saved.publicUrl;
        biz.sessionState = "awaiting_currency";
        biz.sessionData = {};
        await biz.save();
        return sendTwimlText(res, `Logo received. Now reply with currency: ZWL / USD / ZAR`);
      } catch (e) {
        console.error("logo save failed", e);
        return sendTwimlText(res, "Could not save logo — please send JPG/PNG or reply 1 to skip.");
      }
    }

    // Settings menu blocks:
    if (state === "settings_menu" && isSingleNumber) {
      const choice = trimmed;
      if (choice === "0") { await resetSession(biz); return sendMenu(res); }
      if (choice === "1") { biz.sessionState = "settings_currency"; await biz.save(); return sendTwimlText(res, `Current currency: ${biz.currency || "ZWL"}. Reply with new currency (ZWL, USD, ZAR).`); }
      if (choice === "2") { biz.sessionState = "settings_terms"; await biz.save(); return sendTwimlText(res, `Current payment terms: ${biz.paymentTermsDays || 30} days. Reply with new number.`); }
      if (choice === "3") { biz.sessionState = "settings_inv_prefix"; await biz.save(); return sendTwimlText(res, `Current invoice prefix: ${biz.invoicePrefix || "INV"}. Reply with new prefix.`); }
      if (choice === "4") { biz.sessionState = "settings_qt_prefix"; await biz.save(); return sendTwimlText(res, `Current quote prefix: ${biz.quotePrefix || "QT"}. Reply with new prefix.`); }
      if (choice === "5") { biz.sessionState = "awaiting_logo_upload"; await biz.save(); return sendTwimlText(res, "Send new logo image now (or reply 1 to cancel)."); }
      if (choice === "6") {
        const clients = await Client.find({ businessId: biz._id }).sort({ updatedAt: -1 }).limit(50).lean();
        if (!clients.length) { biz.sessionState = "settings_menu"; await biz.save(); return sendTwimlText(res, "No clients saved yet."); }
        let lines = ["Clients:"];
        clients.forEach((c,i)=> lines.push(`${i+1}) ${c.name} — ${c.phone || "no phone"}`));
        biz.sessionState = "settings_menu"; await biz.save();
        return sendTwimlText(res, lines.join("\n"));
      }
      return sendTwimlText(res, "Invalid selection. Reply with setting number or 0 to go back.");
    }

    if (state === "settings_currency") {
      const cur = trimmed.toUpperCase();
      if (!["ZWL","USD","ZAR"].includes(cur)) return sendTwimlText(res, "Invalid currency. Reply with ZWL, USD or ZAR.");
      biz.currency = cur; biz.sessionState = "settings_menu"; await biz.save();
      return sendTwimlText(res, `Currency updated to ${cur}. Back to settings.`);
    }
    if (state === "settings_terms") {
      const days = Number(trimmed);
      if (isNaN(days) || days < 0) return sendTwimlText(res, "Invalid number. Reply with e.g. 30.");
      biz.paymentTermsDays = days; biz.sessionState = "settings_menu"; await biz.save();
      return sendTwimlText(res, `Payment terms updated to ${days} days. Back to settings.`);
    }
    if (state === "settings_inv_prefix") {
      if (!trimmed) return sendTwimlText(res, "Enter a valid prefix.");
      biz.invoicePrefix = trimmed; biz.sessionState = "settings_menu"; await biz.save();
      return sendTwimlText(res, `Invoice prefix set to ${trimmed}. Back to settings.`);
    }
    if (state === "settings_qt_prefix") {
      if (!trimmed) return sendTwimlText(res, "Enter a valid prefix.");
      biz.quotePrefix = trimmed; biz.sessionState = "settings_menu"; await biz.save();
      return sendTwimlText(res, `Quote prefix set to ${trimmed}. Back to settings.`);
    }

    // Add client flows
    if (state === "adding_client_name") {
      const cname = trimmed;
      if (!cname) return sendTwimlText(res, "Please send a client name.");
      biz.sessionData.clientName = cname;
      biz.sessionState = "adding_client_phone";
      biz.markModified('sessionData');
      await biz.save();
      return sendTwimlText(res, "Client phone? (e.g. +263772123456) or reply 1 to cancel.");
    }
    if (state === "adding_client_phone") {
      if (trimmed === "1") { biz.sessionState = "ready"; biz.sessionData = {}; await biz.save(); return sendTwimlText(res, "Cancelled. Reply menu to continue."); }
      const phoneRaw = trimmed;
      const phone = phoneRaw.toLowerCase() === "same" ? providerId : phoneRaw;
      const client = await Client.findOneAndUpdate(
        { businessId: biz._id, phone },
        { $set: { name: biz.sessionData.clientName, phone } },
        { new: true, upsert: true }
      );
      biz.sessionData = {}; biz.sessionState = "ready"; await biz.save();
      return sendTwimlText(res, `Client saved: ${client.name} (${client.phone}). Reply menu to continue.`);
    }

    // Invoice flows (select client)
    if (state === "creating_invoice_choose_client" && isSingleNumber) {
      const choice = trimmed;
      if (choice === "1") {
        const clients = await Client.find({ businessId: biz._id }).sort({ updatedAt: -1 }).limit(5).lean();

        // Auto-select single client
        if (!clients.length) {
          biz.sessionState = "creating_invoice_new_client";
          await biz.save();
          return sendTwimlText(res, "No saved clients. Please enter client name:");
        }

        if (clients.length === 1) {
          const client = clients[0];
          biz.sessionData.client = client;
          biz.sessionData.items = [];
          biz.markModified('sessionData');
          biz.sessionState = "creating_invoice_add_items";
          await biz.save();
          return sendTwimlText(res, `Client set to ${client.name || client.phone}. Now send item description (e.g. 'Website design')`);
        }

        // multiple clients -> list them
        let lines = ["Choose a client by number:"];
        clients.forEach((c, i) => lines.push(`${i+1}) ${c.name || c.phone} ${c.phone ? "- " + c.phone : ""}`));
        lines.push(`${clients.length+1}) New client`);
        biz.sessionState = "creating_invoice_choose_client_index";
        biz.sessionData.recentClients = clients;
        biz.markModified('sessionData');
        await biz.save();
        return sendTwimlText(res, lines.join("\n"));
      }
      if (choice === "2") {
        biz.sessionState = "creating_invoice_new_client"; biz.sessionData = {}; await biz.save();
        return sendTwimlText(res, "Client name?");
      }
      if (choice === "3") { await resetSession(biz); return sendTwimlText(res, "Cancelled. Reply menu to start again."); }
      return sendTwimlText(res, "Invalid selection. Reply with a number.");
    }

    if (state === "creating_invoice_choose_client_index" && isSingleNumber) {
      const idx = Number(trimmed);
      const clients = biz.sessionData.recentClients || [];
      if (!idx || idx < 1 || idx > clients.length + 1) return sendTwimlText(res, "Invalid selection. Reply the client number or choose New client.");
      if (idx === clients.length + 1) { biz.sessionState = "creating_invoice_new_client"; biz.sessionData = {}; await biz.save(); return sendTwimlText(res, "Client name?"); }
      const client = clients[idx-1];
      biz.sessionData.client = client;
      biz.sessionData.items = [];
      biz.markModified('sessionData');
      biz.sessionState = "creating_invoice_add_items";
      await biz.save();
      return sendTwimlText(res, `Client set to ${client.name || client.phone}. Now send item description (e.g. 'Website design')`);
    }

    if (state === "creating_invoice_new_client") {
      if (!biz.sessionData.clientName && trimmed) {
        biz.sessionData.clientName = trimmed; biz.sessionState = "creating_invoice_new_client_phone"; biz.markModified('sessionData'); await biz.save();
        return sendTwimlText(res, "Client phone? (e.g. +263772123456) or reply 1 to cancel.");
      }
    }

    if (state === "creating_invoice_new_client_phone") {
      if (trimmed === "1") { biz.sessionState = "ready"; biz.sessionData = {}; await biz.save(); return sendTwimlText(res, "Cancelled client creation."); }
      const phoneRaw = trimmed;
      const phone = phoneRaw.toLowerCase() === "same" ? providerId : phoneRaw;
      const client = await Client.findOneAndUpdate(
        { businessId: biz._id, phone },
        { $set: { name: biz.sessionData.clientName, phone } },
        { new: true, upsert: true }
      );
      biz.sessionData.client = client; biz.sessionData.items = []; biz.markModified('sessionData');
      biz.sessionState = "creating_invoice_add_items"; await biz.save();
      return sendTwimlText(res, `Client saved: ${client.name} (${client.phone}). Now send item description.`);
    }

    // Items loop: two-phase flow
    if (state === "creating_invoice_add_items") {
      const lowered = trimmed.toLowerCase();

      // short commands
      const isAddAnother = trimmed === "1";
      const isEnterPrices = trimmed === "2" || /(^|\s)(prices|enter prices|prices now|enterprice|enter price)(\s|$)/.test(lowered);
      const isDone = /(^|\s)(done|finish|generate|send)(\s|$)/.test(lowered);
      const isCancel = trimmed === "3" || /(^|\s)(cancel|abort|stop)(\s|$)/.test(lowered);
      const isSkip = /^\s*skip\s*$/i.test(trimmed);

      // If user explicitly chooses to enter prices for items collected so far
      if (isEnterPrices) {
        const items = biz.sessionData.items || [];
        if (!items.length) return sendTwimlText(res, "No items added yet. Send an item description first.");
        // prepare price-entry index if needed
        biz.sessionState = "creating_invoice_enter_prices";
        biz.sessionData.priceIndex = 0;
        biz.markModified('sessionData');
        await biz.save();
        const next = biz.sessionData.items[0];
        return sendTwimlText(res, `Price entry: item 1) ${next.description} x${next.qty}\nEnter unit price (e.g. 450) or reply 'skip' to set 0. Reply 'back' to add more items.`);
      }

      if (isCancel) {
        await resetSession(biz);
        return sendTwimlText(res, "Invoice creation cancelled.");
      }

      if (isAddAnother) {
        // If there is an unfinished item (e.g. description provided but qty not yet), remind user
        if (biz.sessionData.awaitingItemDesc && biz.sessionData.lastItem && (!biz.sessionData.lastItem.qty)) {
          return sendTwimlText(res, "You're in the middle of adding an item — finish qty now, or reply '3' to cancel.");
        }
        return sendTwimlText(res, "Send next item description:");
      }

      // If user wrote 'done' but last item incomplete
      if (isDone) {
        // If lastItem exists and missing price, instruct
        if (biz.sessionData.lastItem && biz.sessionData.lastItem.qty && !biz.sessionData.lastItem.unit) {
          return sendTwimlText(res, "You have a partially-entered item missing unit price. Reply with the price, 'skip' to set it to 0, or 'back' to add more items.");
        }
        const items = biz.sessionData.items || [];
        if (!items.length) return sendTwimlText(res, "No items added. Add an item first.");
        // show summary / confirm
        const subtotal = items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit||0)), 0);
        let summary = `Invoice summary for ${biz.sessionData.client?.name || biz.sessionData.client?.phone || "client"}:\n`;
        items.forEach((it, i) => summary += `${i+1}) ${it.description} x${it.qty} @ ${formatMoney(it.unit||0)} = ${formatMoney((it.qty||0)*(it.unit||0))}\n`);
        summary += `Subtotal: ${formatMoney(subtotal)} ${biz.currency || "ZWL"}\n\n1) Add another item\n2) Send & generate PDF\n3) Cancel`;
        biz.sessionState = "creating_invoice_confirm";
        await biz.save();
        return sendTwimlText(res, summary);
      }

      // Otherwise treat as free text flow: description -> qty -> (item saved without price)
      if (!biz.sessionData.awaitingItemDesc) {
        // expecting description
        const desc = trimmed;
        if (!desc) return sendTwimlText(res, "Send an item description (or reply 2 to enter prices).");
        biz.sessionData.awaitingItemDesc = true;
        biz.sessionData.lastItem = { description: desc };
        biz.markModified('sessionData');
        await biz.save();
        return sendTwimlText(res, "Qty? (e.g. 1)");
      } else if (biz.sessionData.awaitingItemDesc && !biz.sessionData.lastItem.qty) {
        // expecting qty
        const qty = Number(trimmed);
        if (isNaN(qty) || qty <= 0) return sendTwimlText(res, "Invalid qty. Enter a number like '1' (or '3' to cancel).");
        biz.sessionData.lastItem.qty = qty;
        // save item with unit=null (we'll collect prices in second phase)
        biz.sessionData.items = biz.sessionData.items || [];
        biz.sessionData.items.push({ description: biz.sessionData.lastItem.description, qty: qty, unit: null });
        // mark modified so mongoose persists nested changes
        biz.markModified('sessionData');
        // clear lastItem but keep awaitingItemDesc false
        biz.sessionData.lastItem = null;
        biz.sessionData.awaitingItemDesc = false;
        await biz.save();

        // Clear, explicit options so user can indicate they're done adding items and move to price-entry
        return sendTwimlText(res, `Item recorded (without price). Total items: ${biz.sessionData.items.length}\nReply:\n1) Add another item\n2) Enter prices for added items (or reply 'done'/'enter prices')\n3) Cancel`);
      } else {
        // fallback
        return sendTwimlText(res, "Send item description or reply 1/2/3.");
      }
    }

    // Price-entry flow: walk through items with missing price
    if (state === "creating_invoice_enter_prices") {
      const items = biz.sessionData.items || [];
      let idx = Number(biz.sessionData.priceIndex || 0);
      if (!Array.isArray(items) || items.length === 0) {
        biz.sessionState = "creating_invoice_add_items"; biz.sessionData.priceIndex = 0; await biz.save();
        return sendTwimlText(res, "No items to price. Send item description to add items.");
      }

      // Allow user to go back to adding items
      if (trimmed.toLowerCase() === "back") {
        biz.sessionState = "creating_invoice_add_items";
        delete biz.sessionData.priceIndex;
        biz.markModified('sessionData');
        await biz.save();
        return sendTwimlText(res, "Back to adding items. Send next item description or reply '2' when ready to enter prices.");
      }

      // skip sets price to 0 for current item
      if (/^skip$/i.test(trimmed)) {
        items[idx].unit = 0;
        idx += 1;
        biz.sessionData.priceIndex = idx;
        biz.sessionData.items = items;
        biz.markModified('sessionData');
        await biz.save();
      } else {
        // parse price
        const unit = Number(trimmed);
        if (isNaN(unit)) return sendTwimlText(res, "Invalid price. Enter a numeric unit price (e.g. 450), 'skip' to set 0, or 'back' to add more items.");
        items[idx].unit = unit;
        idx += 1;
        biz.sessionData.priceIndex = idx;
        biz.sessionData.items = items;
        biz.markModified('sessionData');
        await biz.save();
      }

      // If still have items to price
      if (idx < (biz.sessionData.items || []).length) {
        const next = biz.sessionData.items[idx];
        return sendTwimlText(res, `Price entry: item ${idx+1}) ${next.description} x${next.qty}\nEnter unit price (e.g. 450) or reply 'skip' to set 0. Reply 'back' to add more items.`);
      }

      // All prices done -> summarize and confirm
      const finalItems = biz.sessionData.items || [];
      const subtotal = finalItems.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit||0)), 0);
      let summary = `Invoice summary for ${biz.sessionData.client?.name || biz.sessionData.client?.phone || "client"}:\n`;
      finalItems.forEach((it, i) => summary += `${i+1}) ${it.description} x${it.qty} @ ${formatMoney(it.unit||0)} = ${formatMoney((it.qty||0)*(it.unit||0))}\n`);
      summary += `Subtotal: ${formatMoney(subtotal)} ${biz.currency || "ZWL"}\n\n1) Add another item\n2) Send & generate PDF\n3) Cancel`;
      biz.sessionState = "creating_invoice_confirm";
      delete biz.sessionData.priceIndex;
      biz.markModified('sessionData');
      await biz.save();
      return sendTwimlText(res, summary);
    }

    // Confirmation: generate invoice or save draft or add more items
    if (state === "creating_invoice_confirm" && isSingleNumber) {
      const choice = trimmed;
      if (choice === "1") {
        biz.sessionState = "creating_invoice_add_items";
        await biz.save();
        return sendTwimlText(res, "Send next item description:");
      }
      if (choice === "2") {
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
          console.error("invoice PDF failed", e);
          return sendTwimlText(res, "Failed to generate invoice PDF; check server logs.");
        }
      } else {
        await resetSession(biz); return sendTwimlText(res, "Cancelled.");
      }
    }

    // Fallback - show menu
    return sendMenu(res);

  } catch (err) {
    console.error("TWILIO (biz): webhook handler error:", err && (err.stack || err.message) ? (err.stack || err.message) : err);
    try { return sendTwimlText(res, "Server error; try again later."); } catch (e) { return res.status(500).end(); }
  }
});

export default router;
