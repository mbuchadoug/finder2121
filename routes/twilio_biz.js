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

let PDFDocument = null; // no longer used for generation, but left in case other code expects it

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

/* ---------- small save helper to mark sessionData modified ---------- */
async function saveBiz(biz) {
  try {
    if (biz && typeof biz.markModified === "function") biz.markModified("sessionData");
    return biz.save();
  } catch (e) {
    return biz.save();
  }
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

/* ---------- PDF helpers (HTML -> PDF via Puppeteer) ---------- */
async function ensurePublicSubdirs() {
  const base = path.join(process.cwd(), "public", "docs", "generated");
  await fs.promises.mkdir(base, { recursive: true });
  for (const sub of ["invoices", "quotes", "receipts"]) {
    await fs.promises.mkdir(path.join(base, sub), { recursive: true });
  }
  return base;
}

/**
 * Build HTML using the exact CSS/structure you provided, with Bootstrap 3.3.7,
 * and the table structure you asked for. We generate rows from `items`.
 */
function buildHtml({ typeLabel, number, dateStr, dueDateStr, companyName, companyAddress, companyPhone, logoUrl, customerName, refNumber, status, items = [], totals = {}, notes = "" }) {
  // ensure items is an array and totals fields exist
  const subtotal = formatMoney(totals.subtotal || 0);
  const payments = formatMoney(totals.payments || 0);
  const balance = formatMoney(totals.balance || 0);
  // create rows HTML
  let rowsHtml = "";
  // The user template uses some nesting; we'll produce simple rows mapping each item
  items.forEach((it) => {
    // it expected fields: quantity, item, description, amount, discount
    rowsHtml += `
      <tr>
        <td style="text-align:center">${it.quantity || ""}</td>
        <td style="text-align:center; word-wrap: break-word">${escapeHtml(it.item || "")}</td>
        <td style="text-align:center; word-wrap: break-word">${escapeHtml(it.description || "")}</td>
        <td style="text-align:center">${formatMoney(it.rate || it.amount || 0)}</td>
        <td style="text-align:center">${it.discount != null ? escapeHtml(String(it.discount)) : ""}</td>
        <td style="text-align:center">${formatMoney(it.amount || (Number(it.quantity||0) * Number(it.rate || 0) - Number(it.discount || 0)))}</td>
      </tr>
    `;
  });

  // if no logo, we will display companyName in the left pane
  const logoImgTag = logoUrl ? `<img src="${escapeAttr(logoUrl)}" alt="logo" style="width:200px;height:250px;display:inline-block;">` : "";

  // Inline CSS from your design + bootstrap 3.3.7
  const html = `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(typeLabel)} ${escapeHtml(number)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css">
    <style>
      @page {
        margin: 0!important;
        margin-top: 0cm!important;
        margin-bottom: 0cm!important;
        margin-left: 0cm!important;
        margin-right: 0cm!important;
        break-inside: avoid;
      }
      * { box-sizing: border-box; }
      table { width: 100%; min-width: max-content; table-layout:fixed; }
      .row { margin-left:-5px; margin-right:-5px; }
      .column { float: left; width: 50%; padding: 5px; }
      .row::after { content: ""; clear: both; display: table; }
      .column-bordered-table thead td { border-left: 1px solid #000000; border-right: 1px solid #000000; }
      .column-bordered-table td { border-left: 1px solid #000000; border-right: 1px solid #000000; }
      .column-bordered-table tfoot tr { border-top: 1px solid #000000; border-bottom: 1px solid #000000; }
      .header img { float: left; width: 200px; height: 100px; background: #555; }
      .header h1 .text-center p h2 { position: relative; top: 18px; left: 10px; }
      .content-container{ padding: 30px; position: relative; }
      .content-container:before{
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        background-image: url("");
        background-size: 500px;
        background-position: center;
        background-repeat: no-repeat;
        width: 100%;
        height: 100%;
        opacity: .05;
        margin-top: 100px;
      }
      .content-container .contents{ position: relative; z-index: 5; }
      .toppane { width: 100%; height: 100px; background-color: #4da6ff; }
      body { margin: 0!important; font-family: Arial, sans-serif; color: #222; }
      .d-flex { display:flex; }
      .leftpane { width: 25%; }
      .middlepane { width: 50%; }
      .rightpane { width: 25%; text-align: right; }
      .column-bordered-table th, .column-bordered-table td { padding: 8px; border-collapse: collapse; }
      .column-bordered-table thead th { background: #f3f3f3; }
      .totals-table { width: 27%; margin-left: auto; border: 1px solid black; border-collapse: collapse; }
      .totals-table td { padding: 8px; border-bottom: 1px solid black; }
      .note { margin-top: 16px; padding: 10px; border-left: 4px solid #4da6ff; background: #fbfdff; }
      .clearfix::after { content: ""; clear: both; display: table; }
    </style>
  </head>
  <body>
    <div class="content-container" style="page-break-before: always">
      <div class="contents">
        <div class="container" style="break-inside: avoid">
          <div class="d-flex clearfix">
            <div class="leftpane">
              ${logoImgTag || `<div style="font-weight:700;font-size:20px;padding:10px;">${escapeHtml(companyName || "")}</div>`}
            </div>
            <div class="middlepane">
              <h1 style="text-align: center;font-family: Georgia, serif; font-size:25px;"><b>${escapeHtml(companyName || "")}</b></h1>
              <p style="text-align: center;">${escapeHtml(companyAddress || "")}</p>
              <p style="text-align: center;">${escapeHtml(companyPhone || "")}</p>
            </div>
            <div class="rightpane">
              <h1 style="margin:0">${escapeHtml(typeLabel)}</h1>
            </div>
          </div>
        </div>

        <div class="row" style="margin-top:12px;">
          <div class="column">
            <table border="1">
              <tr><td colspan="2" style="height:30px;text-align:center">Invoice To</td></tr>
              <tr><td colspan="2" style="height:50px;text-align:center">${escapeHtml(customerName || "")}</td></tr>
            </table>
          </div>

          <div class="column">
            <table border="1">
              <tr><td style="text-align:center">Date</td><td style="text-align:center">${escapeHtml(dateStr || "")}</td></tr>
              <tr><td style="text-align:center">Invoice No</td><td style="text-align:center">${escapeHtml(refNumber || number)}</td></tr>
              <tr><td style="text-align:center">Invoice Status</td><td style="text-align:center">${escapeHtml(status || "")}</td></tr>
            </table>
          </div>
        </div>

        <div style="margin-top:12px;">
          <table border="1" class="column-bordered-table thead" style="break-inside: avoid;border-bottom:1px solid black;">
            <thead>
              <tr>
                <th style="text-align:center;width:10%;">Qty</th>
                <th style="text-align:center;width:30%;">Item</th>
                <th style="text-align:center;width:30%;">Description</th>
                <th style="text-align:center">Rate ($)</th>
                <th style="text-align:center">Discount (%)</th>
                <th style="text-align:center">Amount ($)</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || `<tr><td colspan="6" style="text-align:center;padding:20px">No items</td></tr>`}
              <!-- spacer rows can keep layout consistent for printing -->
              <tr style="height: 80px;"><td colspan="6"></td></tr>
            </tbody>
          </table>
        </div>

        <div style="margin-top:12px;">
          <table class="totals-table" style="margin-top:12px;">
            <tr><td>Total Amount</td><td style="text-align:end">$${subtotal}</td></tr>
            <tr><td>Payments</td><td style="text-align:end">$${payments}</td></tr>
            <tr><td><b>Balance Due</b></td><td style="text-align:end">$${balance}</td></tr>
          </table>
        </div>

        ${notes ? `<div class="note">${escapeHtml(notes)}</div>` : ""}

      </div>
    </div>
  </body>
  </html>
  `;
  return html;
}

// small helper to escape HTML in interpolation
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(str) {
  if (str == null) return "";
  return String(str).replace(/"/g, "%22");
}

/**
 * generatePDF: uses puppeteer to render HTML (bootstrap + provided CSS) and save PDF.
 * Accepts same semantic fields as before plus companyName/companyAddress/companyPhone/logoUrl
 */
async function generatePDF({ type, number, date, dueDate, billingTo, email, items = [], notes = "", companyName = "", companyAddress = "", companyPhone = "", logoUrl = "" }) {
  // ensure pdf directories
  if (!type) type = "invoice";
  const baseDir = await ensurePublicSubdirs();
  const folder = path.join(baseDir, type === "invoice" ? "invoices" : type === "quote" ? "quotes" : "receipts");
  const filename = `${type}-${number}-${Date.now()}.pdf`;
  const filepath = path.join(folder, filename);

  // prepare totals
  const subtotal = items.reduce((s, it) => s + (Number(it.amount || (Number(it.quantity||0) * Number(it.rate || 0))) || 0), 0);
  const payments = 0;
  const balance = subtotal - payments;

  // Build the HTML page using the design you pasted
  const html = buildHtml({
    typeLabel: type === "invoice" ? "INVOICE" : type === "quote" ? "QUOTATION" : "RECEIPT",
    number,
    dateStr: (date && date.toISOString && date.toISOString().slice(0,10)) || String(date || ""),
    dueDateStr: (dueDate && dueDate.toISOString && dueDate.toISOString().slice(0,10)) || (dueDate || ""),
    companyName: companyName || "",
    companyAddress: companyAddress || "",
    companyPhone: companyPhone || "",
    logoUrl: logoUrl || "",
    customerName: billingTo || "",
    refNumber: number,
    status: "",
    items,
    totals: { subtotal, payments, balance },
    notes
  });

  // dynamic import puppeteer so file doesn't crash if not installed
  let puppeteer;
  try {
    puppeteer = await import("puppeteer");
  } catch (e) {
    // try require fallback
    try { puppeteer = require("puppeteer"); } catch (e2) { throw new Error("puppeteer not installed. Install with: npm install puppeteer"); }
  }

  // ensure folder exists
  await fs.promises.mkdir(folder, { recursive: true });

  // Launch headless browser and render PDF
  const launchOpts = {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    // set content and wait until network idle to ensure bootstrap CSS loads
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // set PDF options to A4
    await page.pdf({
      path: filepath,
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" }
    });
    await page.close();
    await browser.close();
    return { filepath, filename };
  } catch (err) {
    try { await browser.close(); } catch (e) {}
    throw err;
  }
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

async function resetSession(biz) { biz.sessionState = null; biz.sessionData = {}; return saveBiz(biz); }

function sendMenu(res) {
  const msg = `ZimQuote — reply with a number:
1) Create business account
2) New invoice
3) Add client
4) Upload logo
5) Settings
6) Help
7) New quotation
8) New receipt`;
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
        receiptPrefix: "RCPT",
        paymentTermsDays: 30
      });
      console.log("TWILIO (biz): created business record", biz._id?.toString());
    }

    if (profileName && !biz.name) {
      biz.name = biz.name || profileName;
      await saveBiz(biz).catch(() => {});
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
      await saveBiz(biz);
      return sendTwimlText(res, `Welcome to ZimQuote 👋\nQuick setup:\n1) Create business account\n2) Try demo\n3) Help\nReply with a number.`);
    }

    // TOP-LEVEL: Strictly accept only numeric single-digit commands for main menu
    const isSingleNumber = /^\d+$/.test(trimmed);
    const state = biz.sessionState || "idle";

    // DEBUG LOG
    console.log("TWILIO (biz): incoming trimmed:", JSON.stringify(trimmed), "sessionState:", state, "isSingleNumber:", isSingleNumber);

    // Accept numeric top-level commands when state is idle, awaiting_first_choice OR ready.
    if ((state === "idle" || state === "awaiting_first_choice" || state === "ready") && isSingleNumber) {
      const num = trimmed;
      // 1 - Create business
      if (num === "1") {
        if (biz.name) return sendTwimlText(res, `You already have a business: "${biz.name}". Reply 5 for settings.`);
        biz.sessionState = "awaiting_business_name";
        biz.sessionData = {};
        await saveBiz(biz);
        return sendTwimlText(res, "Great — what's your business name? (e.g. 'ABC Traders')");
      }

      // 2 - New invoice / 7 - New quotation / 8 - New receipt (reuse invoice flow but set docType)
      if (num === "2" || num === "7" || num === "8") {
        if (!biz.name) {
          biz.sessionState = "awaiting_first_choice"; await saveBiz(biz);
          return sendTwimlText(res, "You need to create a business first. Reply 1 to create.");
        }
        let docType = "invoice";
        if (num === "7") docType = "quote";
        if (num === "8") docType = "receipt";

        biz.sessionState = "creating_invoice_choose_client";
        biz.sessionData = { items: [], docType };
        await saveBiz(biz);

        const label = docType === "invoice" ? "Invoice" : docType === "quote" ? "Quotation" : "Receipt";
        return sendTwimlText(res, `Create ${label} — pick option:\n1) Use saved client\n2) New client\n3) Cancel`);
      }

      // 3 - Add client
      if (num === "3") {
        if (!biz.name) { biz.sessionState = "awaiting_first_choice"; await saveBiz(biz); return sendTwimlText(res, "You need to create a business first. Reply 1 to create."); }
        biz.sessionState = "adding_client_name";
        biz.sessionData = {};
        await saveBiz(biz);
        return sendTwimlText(res, "Adding client — what's the client name?");
      }
      // 4 - Upload logo
      if (num === "4") {
        biz.sessionState = "awaiting_logo_upload";
        biz.sessionData = {};
        await saveBiz(biz);
        return sendTwimlText(res, "Please send your business logo (as an image). Reply 1 to skip.");
      }
      // 5 - Settings
      if (num === "5") {
        biz.sessionState = "settings_menu";
        await saveBiz(biz);
        const sMsg = `Settings for ${biz.name || "(unnamed)"}:
1) Currency (current: ${biz.currency || "ZWL"})
2) Payment terms days (current: ${biz.paymentTermsDays || 30})
3) Invoice prefix (current: ${biz.invoicePrefix || "INV"})
4) Quote prefix (current: ${biz.quotePrefix || "QT"})
5) Change logo
6) View clients
7) Receipt prefix (current: ${biz.receiptPrefix || "RCPT"})
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
7) New quotation
8) New receipt
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
      await saveBiz(biz);
      return sendTwimlText(res, `Thanks — "${name}".\nSend your logo image now, or reply 1 to skip, 2 to add later.`);
    }

    if (state === "awaiting_logo_choice") {
      if (trimmed === "1") { biz.sessionState = "awaiting_currency"; await saveBiz(biz); return sendTwimlText(res, `Logo skipped. What currency do you want? (ZWL, USD, ZAR)`); }
      if (trimmed === "2") { biz.sessionState = "ready"; biz.sessionData = {}; await saveBiz(biz); return sendTwimlText(res, `Setup finished. Reply menu to see commands.`); }
      return sendTwimlText(res, `Send an image file for your logo, or reply 1 to skip, 2 to add later.`);
    }

    if (state === "awaiting_currency") {
      const cur = trimmed.toUpperCase();
      if (!["ZWL","USD","ZAR"].includes(cur)) { biz.sessionState = "awaiting_currency"; await saveBiz(biz); return sendTwimlText(res, "Invalid currency. Reply ZWL, USD or ZAR."); }
      biz.currency = cur; biz.sessionState = "ready"; await saveBiz(biz);
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
        await saveBiz(biz);
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
      if (choice === "1") { biz.sessionState = "settings_currency"; await saveBiz(biz); return sendTwimlText(res, `Current currency: ${biz.currency || "ZWL"}. Reply with new currency (ZWL, USD, ZAR).`); }
      if (choice === "2") { biz.sessionState = "settings_terms"; await saveBiz(biz); return sendTwimlText(res, `Current payment terms: ${biz.paymentTermsDays || 30} days. Reply with new number.`); }
      if (choice === "3") { biz.sessionState = "settings_inv_prefix"; await saveBiz(biz); return sendTwimlText(res, `Current invoice prefix: ${biz.invoicePrefix || "INV"}. Reply with new prefix.`); }
      if (choice === "4") { biz.sessionState = "settings_qt_prefix"; await saveBiz(biz); return sendTwimlText(res, `Current quote prefix: ${biz.quotePrefix || "QT"}. Reply with new prefix.`); }
      if (choice === "5") { biz.sessionState = "awaiting_logo_upload"; await saveBiz(biz); return sendTwimlText(res, "Send new logo image now (or reply 1 to cancel)."); }
      if (choice === "6") {
        const clients = await Client.find({ businessId: biz._id }).sort({ updatedAt: -1 }).limit(50).lean();
        if (!clients.length) { biz.sessionState = "settings_menu"; await saveBiz(biz); return sendTwimlText(res, "No clients saved yet."); }
        let lines = ["Clients:"];
        clients.forEach((c,i)=> lines.push(`${i+1}) ${c.name} — ${c.phone || "no phone"}`));
        biz.sessionState = "settings_menu"; await saveBiz(biz);
        return sendTwimlText(res, lines.join("\n"));
      }
      if (choice === "7") { biz.sessionState = "settings_rcpt_prefix"; await saveBiz(biz); return sendTwimlText(res, `Current receipt prefix: ${biz.receiptPrefix || "RCPT"}. Reply with new prefix.`); }
      return sendTwimlText(res, "Invalid selection. Reply with setting number or 0 to go back.");
    }

    if (state === "settings_currency") {
      const cur = trimmed.toUpperCase();
      if (!["ZWL","USD","ZAR"].includes(cur)) return sendTwimlText(res, "Invalid currency. Reply with ZWL, USD or ZAR.");
      biz.currency = cur; biz.sessionState = "settings_menu"; await saveBiz(biz);
      return sendTwimlText(res, `Currency updated to ${cur}. Back to settings.`);
    }
    if (state === "settings_terms") {
      const days = Number(trimmed);
      if (isNaN(days) || days < 0) return sendTwimlText(res, "Invalid number. Reply with e.g. 30.");
      biz.paymentTermsDays = days; biz.sessionState = "settings_menu"; await saveBiz(biz);
      return sendTwimlText(res, `Payment terms updated to ${days} days. Back to settings.`);
    }
    if (state === "settings_inv_prefix") {
      if (!trimmed) return sendTwimlText(res, "Enter a valid prefix.");
      biz.invoicePrefix = trimmed; biz.sessionState = "settings_menu"; await saveBiz(biz);
      return sendTwimlText(res, `Invoice prefix set to ${trimmed}. Back to settings.`);
    }
    if (state === "settings_qt_prefix") {
      if (!trimmed) return sendTwimlText(res, "Enter a valid prefix.");
      biz.quotePrefix = trimmed; biz.sessionState = "settings_menu"; await saveBiz(biz);
      return sendTwimlText(res, `Quote prefix set to ${trimmed}. Back to settings.`);
    }
    if (state === "settings_rcpt_prefix") {
      if (!trimmed) return sendTwimlText(res, "Enter a valid prefix.");
      biz.receiptPrefix = trimmed; biz.sessionState = "settings_menu"; await saveBiz(biz);
      return sendTwimlText(res, `Receipt prefix set to ${trimmed}. Back to settings.`);
    }

    // Add client flows
    if (state === "adding_client_name") {
      const cname = trimmed;
      if (!cname) return sendTwimlText(res, "Please send a client name.");
      biz.sessionData.clientName = cname;
      biz.sessionState = "adding_client_phone";
      await saveBiz(biz);
      return sendTwimlText(res, "Client phone? (e.g. +263772123456) or reply 1 to cancel.");
    }
    if (state === "adding_client_phone") {
      if (trimmed === "1") { biz.sessionState = "ready"; biz.sessionData = {}; await saveBiz(biz); return sendTwimlText(res, "Cancelled. Reply menu to continue."); }
      const phoneRaw = trimmed;
      const phone = phoneRaw.toLowerCase() === "same" ? providerId : phoneRaw;
      const client = await Client.findOneAndUpdate(
        { businessId: biz._id, phone },
        { $set: { name: biz.sessionData.clientName, phone } },
        { new: true, upsert: true }
      );
      biz.sessionData = {}; biz.sessionState = "ready"; await saveBiz(biz);
      return sendTwimlText(res, `Client saved: ${client.name} (${client.phone}). Reply menu to continue.`);
    }

    // Invoice/Quote/Receipt flows (select client)
    if (state === "creating_invoice_choose_client" && isSingleNumber) {
      const choice = trimmed;
      if (choice === "1") {
        const clients = await Client.find({ businessId: biz._id }).sort({ updatedAt: -1 }).limit(5).lean();

        // Auto-select single client
        if (!clients.length) {
          biz.sessionState = "creating_invoice_new_client";
          await saveBiz(biz);
          return sendTwimlText(res, "No saved clients. Please enter client name:");
        }

        if (clients.length === 1) {
          const client = clients[0];
          biz.sessionData.client = client;
          biz.sessionState = "creating_invoice_add_items";
          biz.sessionData.items = biz.sessionData.items || [];
          biz.sessionData.awaitingItemDesc = false;
          biz.sessionData.lastItem = null;
          await saveBiz(biz);
          const docType = biz.sessionData.docType || "invoice";
          const label = docType === "invoice" ? "Invoice" : docType === "quote" ? "Quotation" : "Receipt";
          return sendTwimlText(res, `Client set to ${client.name || client.phone}. Now send item description for ${label} (e.g. 'Website design')`);
        }

        // multiple clients -> list them
        let lines = ["Choose a client by number:"];
        clients.forEach((c, i) => lines.push(`${i+1}) ${c.name || c.phone} ${c.phone ? "- " + c.phone : ""}`));
        lines.push(`${clients.length+1}) New client`);
        biz.sessionState = "creating_invoice_choose_client_index";
        biz.sessionData.recentClients = clients;
        await saveBiz(biz);
        return sendTwimlText(res, lines.join("\n"));
      }
      if (choice === "2") {
        biz.sessionState = "creating_invoice_new_client"; biz.sessionData = {}; await saveBiz(biz);
        return sendTwimlText(res, "Client name?");
      }
      if (choice === "3") { await resetSession(biz); return sendTwimlText(res, "Cancelled. Reply menu to start again."); }
      return sendTwimlText(res, "Invalid selection. Reply with a number.");
    }

    if (state === "creating_invoice_choose_client_index" && isSingleNumber) {
      const idx = Number(trimmed);
      const clients = biz.sessionData.recentClients || [];
      if (!idx || idx < 1 || idx > clients.length + 1) return sendTwimlText(res, "Invalid selection. Reply the client number or choose New client.");
      if (idx === clients.length + 1) { biz.sessionState = "creating_invoice_new_client"; biz.sessionData = {}; await saveBiz(biz); return sendTwimlText(res, "Client name?"); }
      const client = clients[idx-1];
      biz.sessionData.client = client;
      biz.sessionState = "creating_invoice_add_items";
      biz.sessionData.items = biz.sessionData.items || [];
      biz.sessionData.awaitingItemDesc = false;
      biz.sessionData.lastItem = null;
      await saveBiz(biz);
      const docType = biz.sessionData.docType || "invoice";
      const label = docType === "invoice" ? "Invoice" : docType === "quote" ? "Quotation" : "Receipt";
      return sendTwimlText(res, `Client set to ${client.name || client.phone}. Now send item description for ${label} (e.g. 'Website design')`);
    }

    if (state === "creating_invoice_new_client") {
      if (!biz.sessionData.clientName && trimmed) {
        biz.sessionData.clientName = trimmed; biz.sessionState = "creating_invoice_new_client_phone"; await saveBiz(biz);
        return sendTwimlText(res, "Client phone? (e.g. +263772123456) or reply 1 to cancel.");
      }
    }

    if (state === "creating_invoice_new_client_phone") {
      if (trimmed === "1") { biz.sessionState = "ready"; biz.sessionData = {}; await saveBiz(biz); return sendTwimlText(res, "Cancelled client creation."); }
      const phoneRaw = trimmed;
      const phone = phoneRaw.toLowerCase() === "same" ? providerId : phoneRaw;
      const client = await Client.findOneAndUpdate(
        { businessId: biz._id, phone },
        { $set: { name: biz.sessionData.clientName, phone } },
        { new: true, upsert: true }
      );
      biz.sessionData.client = client; biz.sessionData.items = []; biz.sessionState = "creating_invoice_add_items";
      biz.sessionData.awaitingItemDesc = false;
      biz.sessionData.lastItem = null;
      await saveBiz(biz);
      const docType = biz.sessionData.docType || "invoice";
      const label = docType === "invoice" ? "Invoice" : docType === "quote" ? "Quotation" : "Receipt";
      return sendTwimlText(res, `Client saved: ${client.name} (${client.phone}). Now send item description for ${label}.`);
    }

    //
    // Items loop: two-phase flow (description/qty first, prices second)
    //
    if (state === "creating_invoice_add_items") {
      const lowered = trimmed.toLowerCase();

      // commands recognized when not in the middle of typing qty:
      const isCancel = trimmed === "3" || /(^|\s)(cancel|abort|stop)(\s|$)/.test(lowered);
      const wantsEnterPrices = trimmed === "2" || /(^|\s)(prices|enter prices|enter price|enterprices)(\s|$)/.test(lowered);
      const wantsAddAnother = trimmed === "1"; // only used when not entering qty

      // IMPORTANT: if we're currently awaiting a qty for a just-sent description,
      // treat a numeric reply as the qty (priority over '1' means qty '1' is accepted).
      if (biz.sessionData.awaitingItemDesc && biz.sessionData.lastItem && (!biz.sessionData.lastItem.qty)) {
        // expecting qty
        const qty = Number(trimmed);
        if (isNaN(qty) || qty <= 0) {
          // allow user to cancel while waiting for qty
          if (trimmed === "3") { await resetSession(biz); return sendTwimlText(res, "Cancelled. Reply 'menu' to start again."); }
          return sendTwimlText(res, "Invalid qty. Enter a number like '1' (or '3' to cancel).");
        }
        // save item (unit null for now)
        biz.sessionData.lastItem.qty = qty;
        biz.sessionData.items = biz.sessionData.items || [];
        biz.sessionData.items.push({ description: biz.sessionData.lastItem.description, qty: qty, unit: null });
        biz.sessionData.lastItem = null;
        biz.sessionData.awaitingItemDesc = false;
        await saveBiz(biz);
        return sendTwimlText(res, `Item recorded (without price). Total items: ${biz.sessionData.items.length}\nReply:\n1) Add another item\n2) Enter prices for added items\n3) Cancel`);
      }

      // If the user asked to cancel
      if (isCancel) {
        await resetSession(biz);
        return sendTwimlText(res, "Invoice creation cancelled.");
      }

      // If user explicitly wants to enter prices now (and we are not waiting for qty)
      if (wantsEnterPrices) {
        const items = biz.sessionData.items || [];
        if (!items.length) return sendTwimlText(res, "No items added yet. Send an item description first.");
        biz.sessionState = "creating_invoice_enter_prices";
        biz.sessionData.priceIndex = 0;
        biz.sessionData.items = items;
        await saveBiz(biz);
        const next = biz.sessionData.items[0];
        return sendTwimlText(res, `Price entry: item 1) ${next.description} x${next.qty}\nEnter unit price (e.g. 450) or reply 'skip' to set 0. Reply 'back' to add more items.`);
      }

      // If user chooses to add another item (and not in qty mode), prompt for description
      if (wantsAddAnother) {
        // start a fresh item description flow
        biz.sessionData.awaitingItemDesc = false;
        biz.sessionData.lastItem = null;
        await saveBiz(biz);
        return sendTwimlText(res, "Send next item description:");
      }

      // Otherwise treat as free text => expecting new description
      if (!biz.sessionData.awaitingItemDesc) {
        const desc = trimmed;
        if (!desc) return sendTwimlText(res, "Send an item description (or reply 2 to enter prices).");
        biz.sessionData.awaitingItemDesc = true;
        biz.sessionData.lastItem = { description: desc };
        await saveBiz(biz);
        return sendTwimlText(res, "Qty? (e.g. 1)");
      }

      // fallback
      return sendTwimlText(res, "Send item description or reply 1/2/3.");
    }

    //
    // Price-entry flow: walk through items with missing price
    //
    if (state === "creating_invoice_enter_prices") {
      const items = biz.sessionData.items || [];
      let idx = Number(biz.sessionData.priceIndex || 0);
      if (!Array.isArray(items) || items.length === 0) {
        biz.sessionState = "creating_invoice_add_items"; biz.sessionData.priceIndex = 0; await saveBiz(biz);
        return sendTwimlText(res, "No items to price. Send item description to add items.");
      }

      const lowered = trimmed.toLowerCase();
      // allow 'back' to return to adding items before finishing pricing
      if (lowered === "back") {
        biz.sessionState = "creating_invoice_add_items";
        delete biz.sessionData.priceIndex;
        await saveBiz(biz);
        return sendTwimlText(res, "Back to adding items. Send next item description or reply '2' when ready to enter prices.");
      }

      // allow 'skip' to set price 0
      if (/^skip$/i.test(trimmed)) {
        items[idx].unit = 0;
        idx += 1;
        biz.sessionData.priceIndex = idx;
        biz.sessionData.items = items;
        await saveBiz(biz);
      } else {
        const unit = Number(trimmed);
        if (isNaN(unit)) return sendTwimlText(res, "Invalid price. Enter a numeric unit price (e.g. 450), 'skip' to set 0, or 'back' to add more items.");
        items[idx].unit = unit;
        // compute line amount and store fields we will use for HTML table
        items[idx].rate = unit;
        items[idx].amount = (Number(items[idx].qty || 0) * Number(unit)) - Number(items[idx].discount || 0);
        idx += 1;
        biz.sessionData.priceIndex = idx;
        biz.sessionData.items = items;
        await saveBiz(biz);
      }

      // If still have items to price
      if (idx < (biz.sessionData.items || []).length) {
        const next = biz.sessionData.items[idx];
        return sendTwimlText(res, `Price entry: item ${idx+1}) ${next.description} x${next.qty}\nEnter unit price (e.g. 450) or reply 'skip' to set 0. Reply 'back' to add more items.`);
      }

      // All prices done -> summarize and confirm
      const finalItems = biz.sessionData.items || [];
      const subtotal = finalItems.reduce((s, it) => s + (Number(it.amount||0)), 0);
      const docType = biz.sessionData.docType || "invoice";
      const label = docType === "invoice" ? "Invoice" : docType === "quote" ? "Quotation" : "Receipt";
      let summary = `${label} summary for ${biz.sessionData.client?.name || biz.sessionData.client?.phone || "client"}:\n`;
      finalItems.forEach((it, i) => summary += `${i+1}) ${it.description} x${it.qty} @ ${formatMoney(it.rate||0)} = ${formatMoney(it.amount||0)}\n`);
      summary += `Subtotal: ${formatMoney(subtotal)} ${biz.currency || "ZWL"}\n\n1) Add another item\n2) Send & generate PDF\n3) Cancel`;
      biz.sessionState = "creating_invoice_confirm";
      delete biz.sessionData.priceIndex;
      await saveBiz(biz);
      return sendTwimlText(res, summary);
    }

    //
    // Confirmation: generate invoice/quote/receipt or add more items
    //
    if (state === "creating_invoice_confirm" && isSingleNumber) {
      const choice = trimmed;
      if (choice === "1") {
        // back to item adding mode
        biz.sessionState = "creating_invoice_add_items";
        await saveBiz(biz);
        return sendTwimlText(res, "Send next item description:");
      }
      if (choice === "2") {
        const items = biz.sessionData.items || [];
        const client = biz.sessionData.client;
        const docType = (biz.sessionData.docType || "invoice"); // "invoice" | "quote" | "receipt"

        // ensure counters object
        biz.counters = biz.counters || { invoice: 0, quote: 0, receipt: 0 };
        // pick counter field name
        const counterKey = docType === "invoice" ? "invoice" : docType === "quote" ? "quote" : "receipt";
        biz.counters[counterKey] = (biz.counters[counterKey] || 0) + 1;

        // choose prefix field
        const prefix = docType === "invoice" ? (biz.invoicePrefix || "INV") : docType === "quote" ? (biz.quotePrefix || "QT") : (biz.receiptPrefix || "RCPT");
        const numberStr = `${prefix}-${String(biz.counters[counterKey]).padStart(6, "0")}`;

        const date = new Date();
        try {
          // call new generatePDF (HTML -> PDF)
          const { filename } = await generatePDF({
            type: docType === "invoice" ? "invoice" : docType === "quote" ? "quote" : "receipt",
            number: numberStr,
            date,
            dueDate: null,
            billingTo: client?.name || client?.phone,
            email: client?.email || "",
            items,
            notes: "",
            companyName: biz.name || "",
            companyAddress: biz.address || "",
            companyPhone: biz.phone || "",
            logoUrl: biz.logoUrl || ""
          });
          // save updated counters
          await saveBiz(biz);
          const site = (process.env.SITE_URL || "").replace(/\/$/, "");
          const baseForMedia = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
          const url = `${baseForMedia}/docs/generated/${docType === "invoice" ? "invoices" : docType === "quote" ? "quotes" : "receipts"}/${filename}`;
          await resetSession(biz);
          const label = docType === "invoice" ? "Invoice" : docType === "quote" ? "Quotation" : "Receipt";
          return sendTwimlWithMedia(res, `${label} ${numberStr} created. Download: ${url}`, [url]);
        } catch (e) {
          console.error("document PDF failed", e);
          return sendTwimlText(res, `Failed to generate ${docType} PDF; check server logs.`);
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
