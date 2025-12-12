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

// optional: try to use puppeteer-core if present (or puppeteer)
let puppeteer = null;
try {
  // prefer puppeteer-core/pupeteer if installed
  puppeteer = await (async () => {
    try { return (await import("puppeteer")).default || (await import("puppeteer")); } catch (e) {}
    try { return (await import("puppeteer-core")).default || (await import("puppeteer-core")); } catch (e) {}
    return null;
  })();
} catch (e) {
  puppeteer = null;
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
    // if text is null/undefined/empty we do not set body (so no download/link text)
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

/* ---------- Twilio request verification (unchanged) ---------- */
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

/* ---------- PDF helpers (attempt puppeteer HTML render, fallback to pdfkit) ---------- */
async function ensurePublicSubdirs() {
  const base = path.join(process.cwd(), "public", "docs", "generated");
  await fs.promises.mkdir(base, { recursive: true });
  for (const sub of ["invoices", "quotes", "receipts"]) {
    await fs.promises.mkdir(path.join(base, sub), { recursive: true });
  }
  return base;
}

/**
 * Renders given HTML to a PDF file path using Puppeteer (preferred).
 * Throws if puppeteer is not available or fails to launch.
 */
async function renderHtmlToPdf(html, filepath) {
  if (!puppeteer) throw new Error("Puppeteer not available");
  // launch options: prefer environment executable path if provided
  const launchOptions = {
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };
  // If user set an explicit executable path (for system Chrome/Chromium)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // Allow custom options via env (stringified JSON)
  if (process.env.PUPPETEER_LAUNCH_OPTS) {
    try {
      const extra = JSON.parse(process.env.PUPPETEER_LAUNCH_OPTS);
      Object.assign(launchOptions, extra);
    } catch (e) {
      console.warn("Invalid PUPPETEER_LAUNCH_OPTS JSON, ignoring");
    }
  }

  // Try to launch
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    // allow remote content (bootstrap), set timeout
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    await page.emulateMediaType("screen");
    await page.pdf({ path: filepath, format: "A4", printBackground: true, margin: { top: "20mm", bottom: "20mm", left: "12mm", right: "12mm" } });
  } finally {
    try { await browser.close(); } catch (e) {}
  }
}

/**
 * Fallback pdfkit generator (keeps the earlier simple layout)
 * used if Puppeteer isn't available or fails.
 *
 * NOTE: Updated to remove "Description" column (prints item name instead) and include discount/vat.
 */
function drawTablePdfkit(doc, items, startX, startY, columnWidths, docDiscountPercent = 0) {
  const lineHeight = 18;
  let y = startY;
  doc.fontSize(10).fillColor("black");
  // header: Item | Qty | Unit | Discount | Total
  doc.text("Item", startX, y, { width: columnWidths[0] });
  doc.text("Qty", startX + columnWidths[0] + 10, y, { width: columnWidths[1], align: "right" });
  doc.text("Unit", startX + columnWidths[0] + 10 + columnWidths[1] + 10, y, { width: columnWidths[2], align: "right" });
  doc.text("Discount (%)", startX + columnWidths[0] + 10 + columnWidths[1] + 10 + columnWidths[2] + 10, y, { width: columnWidths[3], align: "right" });
  doc.text("Total", startX + columnWidths[0] + 10 + columnWidths[1] + 10 + columnWidths[2] + 10 + columnWidths[3] + 10, y, { width: columnWidths[4], align: "right" });
  y += lineHeight;
  try {
    const totalColsWidth = columnWidths.reduce((a,b) => a + b, 0) + 40;
    doc.moveTo(startX, y - 6).lineTo(startX + totalColsWidth, y - 6).strokeOpacity(0.08).stroke();
  } catch(e) {}
  for (const it of items) {
    doc.fontSize(10).fillColor("black");
    const itemName = it.item || it.description || "";
    const qty = Number(it.qty || it.quantity || 1);
    const unit = Number(it.unit || it.rate || 0);
    const amount = qty * unit;
    const rowDiscount = (typeof it.discount !== "undefined" && it.discount !== null) ? Number(it.discount) : Number(docDiscountPercent || 0);

    doc.text(itemName, startX, y, { width: columnWidths[0] });
    doc.text(String(qty), startX + columnWidths[0] + 10, y, { width: columnWidths[1], align: "right" });
    doc.text(formatMoney(unit), startX + columnWidths[0] + 10 + columnWidths[1] + 10, y, { width: columnWidths[2], align: "right" });
    doc.text(formatMoney(rowDiscount), startX + columnWidths[0] + 10 + columnWidths[1] + 10 + columnWidths[2] + 10, y, { width: columnWidths[3], align: "right" });
    doc.text(formatMoney(amount), startX + columnWidths[0] + 10 + columnWidths[1] + 10 + columnWidths[2] + 10 + columnWidths[3] + 10, y, { width: columnWidths[4], align: "right" });
    y += lineHeight;
  }
  return y;
}

/* ---------- generatePDF: Puppeteer-first, Bootstrap 3.3.7 design, PDFKit fallback ---------- */
async function generatePDF({ type, number, date, dueDate, billingTo, email, items = [], notes = "", bizMeta = {} }) {
  // try HTML -> PDF via Puppeteer first (preferred)
  const baseDir = await ensurePublicSubdirs();
  const folder = path.join(baseDir, type === "invoice" ? "invoices" : type === "quote" ? "quotes" : "receipts");
  const filename = `${type}-${number}-${Date.now()}.pdf`;
  const filepath = path.join(folder, filename);

  // Build HTML from template (bootstrap 3.3.7 + your layout)
  function buildHtml() {
    const typeLabel = type === "invoice" ? "INVOICE" : type === "quote" ? "QUOTATION" : "RECEIPT";
    const companyName = bizMeta.name || "";
    const logoUrl = bizMeta.logoUrl || "";
    const companyAddress = bizMeta.address || "";

    // document-level discount (percent) fallback for rows
    const discountPercentDoc = Number(bizMeta.discountPercent || 0);

    // Removed description column from table HTML. Discount column uses item-level discount or document-level fallback.
    const itemsRowsHtml = items.map(it => {
      const rowDiscount = (typeof it.discount !== "undefined" && it.discount !== null) ? it.discount : discountPercentDoc;
      const qty = it.qty || it.quantity || 1;
      const rate = Number(it.unit || it.rate || 0);
      const amount = qty * rate;
      return `
        <tr>
          <td style="text-align:center; width:8%">${qty}</td>
          <td style="text-align:center; width:40%">${escapeHtml(it.item || it.description || "")}</td>
          <td style="text-align:center; width:12%">${formatMoney(rate)}</td>
          <td style="text-align:center; width:8%">${escapeHtml(String(rowDiscount || 0))}</td>
          <td style="text-align:center; width:20%">${formatMoney(amount)}</td>
        </tr>
      `;
    }).join("\n");

    const subtotal = items.reduce((s, it) => s + (Number(it.qty || it.quantity || 0) * Number(it.unit || it.rate || 0)), 0);

    // document-level discount
    const discountPercent = Number(bizMeta.discountPercent || 0);
    const discountAmount = +(subtotal * (discountPercent / 100));
    const taxableBase = subtotal - discountAmount;

    // vat
    const vatPercent = Number(bizMeta.vatPercent || 0);
    const applyVat = (bizMeta.applyVat === false) ? false : true;
    const vat = applyVat ? +(taxableBase * (vatPercent/100)) : 0;
    const total = taxableBase + vat;

    // Basic escape helper
    return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(typeLabel)} ${escapeHtml(number)}</title>
  <!-- Bootstrap 3.3.7 -->
  <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css">
  <style>
    @page{ margin:0; }
    body{ font-family: Arial, Helvetica, sans-serif; padding:18px; color:#222; }
    .top{ display:flex; align-items:center; justify-content:space-between; }
    .brand{ display:flex; align-items:center; gap:12px; }
    .brand img{ max-height:90px; max-width:200px; object-fit:contain; }
    .company-name{ font-size:20px; font-weight:700; }
    .meta{text-align:right;}
    .meta h2{ margin:0; font-size:18px; color:#333; }
    table.items{ width:100%; border-collapse:collapse; margin-top:18px; }
    table.items th, table.items td{ border:1px solid #222; padding:8px; font-size:12px; }
    table.items th{ background:#f2f2f2; font-weight:700; text-align:center; }
    .totals{ width:320px; float:right; margin-top:12px; border:1px solid #222; border-collapse:collapse; }
    .totals td{ padding:8px; border-bottom:1px solid #222; }
    .totals tr:last-child td{ font-weight:800; font-size:14px; }
    .logo-text{ font-size:18px; font-weight:700; }
    .watermark{ position: fixed; left:0; top:140px; right:0; opacity:0.06; text-align:center; font-size:72px; transform: rotate(-20deg); pointer-events:none; }
    /* your custom invoice CSS (copied from user design) */
    table { width: 100%; min-width: max-content; table-layout:fixed; }
    .row { margin-left:-5px; margin-right:-5px; }
    .column { float: left; width: 50%; padding: 5px; }
    .row::after { content: ""; clear: both; display: table; }
    .column-bordered-table thead td { border-left: 1px solid #000000; border-right: 1px solid #000000; }
    .column-bordered-table td { border-left: 1px solid #000000; border-right: 1px solid #000000; }
    .column-bordered-table tfoot tr { border-top: 1px solid #000000; border-bottom: 1px solid #000000; }
    .header img { float: left; width: 200px; height: 100px; background: #555; }
    .content-container{ padding: 30px; position: relative; }
    .content-container:before{ content: ""; position: absolute; top: 0; left: 0; background-image: url("https://lh3.googleusercontent.com/p/AF1QipM4QsTyJAvH2mqbi7nscU_rI0itolqM4uAEL9G2=s680-w680-h510"); background-size: 500px; background-position: center; background-repeat: no-repeat; width: 100%; height: 100%; opacity: .1; margin-top: 100px; }
    .content-container .contents{ position: relative; z-index: 5; }
    .toppane { width: 100%; height: 100px; background-color: #4da6ff; }
    .leftpane { width: 25%; height: 45vh; }
    .middlepane { width: 50%; height: 40vh; }
    .rightpane { width: 20%; height: 35vh; }
    body { margin: 0!important; }
    .d-flex { display: flex; }
  </style>
</head>
<body>
  <div class="top">
    <div class="brand">
    ${logoUrl
      ? `<div style="display:flex; align-items:center; gap:12px;"><img src="${escapeHtml(logoUrl)}" alt="logo" /><div><div class="company-name">${escapeHtml(companyName)}</div><div style="font-size:12px; color:#555;">${escapeHtml(companyAddress)}</div></div></div>`
      : `<div><div class="company-name">${escapeHtml(companyName)}</div><div style="font-size:12px; color:#555;">${escapeHtml(companyAddress)}</div></div>`
    }
  </div>

    <div class="meta">
      <div style="font-weight:700; font-size:16px">${escapeHtml(typeLabel)}</div>
      <div style="margin-top:6px">No: <strong>${escapeHtml(number)}</strong></div>
      <div style="margin-top:6px">Date: ${escapeHtml(date.toISOString().slice(0,10))}</div>
      ${ dueDate ? `<div>Due: ${escapeHtml(dueDate.toISOString().slice(0,10))}</div>` : ""}
    </div>
  </div>

  <div style="margin-top:18px; display:flex; justify-content:space-between;">
    <div>
      <div style="font-size:12px; color:#666;">Bill To</div>
      <div style="font-weight:700; margin-top:6px;">${escapeHtml(billingTo || "")}</div>
      ${ email ? `<div style="font-size:12px; color:#666;">${escapeHtml(email)}</div>` : "" }
    </div>

    <div style="text-align:right; font-size:12px; color:#666;">
      Document #: <strong>${escapeHtml(number)}</strong>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:6%;">Qty</th>
        <th style="width:40%;">Item</th>
        <th style="width:12%;">Rate ($)</th>
        <th style="width:8%;">Discount (%)</th>
        <th style="width:20%;">Amount ($)</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRowsHtml}
    </tbody>
  </table>

  <table class="totals" cellpadding="0" cellspacing="0">
    <tr><td style="width:60%;">Subtotal</td><td style="text-align:right;">${formatMoney(subtotal)}</td></tr>
    <tr><td>Discount (${formatMoney(discountPercent)}%)</td><td style="text-align:right;">${formatMoney(discountAmount)}</td></tr>
    <tr><td>VAT (${formatMoney(vatPercent)}%)</td><td style="text-align:right;">${formatMoney(vat)}</td></tr>
    <tr><td>Total</td><td style="text-align:right;">${formatMoney(total)}</td></tr>
  </table>

  ${ notes ? `<div style="clear:both; margin-top:16px; border-left:4px solid #1f6feb; background:#fbfdff; padding:10px; border-radius:4px;">${escapeHtml(notes)}</div>` : "" }


</body>
</html>
    `;
  }

  // small helper: escape HTML
  function escapeHtml(s) {
    if (s === undefined || s === null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Try puppeteer first
  try {
    const html = buildHtml();
    if (puppeteer) {
      try {
        await renderHtmlToPdf(html, filepath);
        return { filepath, filename, method: "puppeteer" };
      } catch (e) {
        console.error("generatePDF: Puppeteer render failed:", e && (e.stack || e.message) ? (e.stack || e.message) : e);
        // continue to pdfkit fallback
      }
    } else {
      console.info("generatePDF: puppeteer not installed; falling back to pdfkit");
    }
  } catch (errHtml) {
    console.warn("generatePDF: building HTML failed, falling back to pdfkit", errHtml && errHtml.message);
  }

  // Fallback: pdfkit (keeps original behavior)
  if (!PDFDocument) throw new Error("pdfkit not available. Install with: npm install pdfkit");

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // header (logo or company name)
      if (bizMeta.logoUrl && bizMeta.logoUrl.startsWith("http")) {
        // attempt to download inline image for pdfkit - skipping network in this simple fallback
        try {
          // if local logo exists in public/docs/logos we can embed
          const localLogo = path.join(process.cwd(), "public", "docs", "logos", `logo-${bizMeta._id || "biz"}.png`);
          if (fs.existsSync(localLogo)) doc.image(localLogo, 50, 45, { width: 90 });
        } catch (e) {}
      } else if (bizMeta.name) {
        doc.fontSize(18).text(bizMeta.name, 50, 50);
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
      // columnWidths adjusted for Item | Qty | Unit | Discount | Total
      const columnWidths = [220, 60, 70, 70, 80];
      const afterTableY = drawTablePdfkit(doc, items, 50, startY, columnWidths, Number(bizMeta.discountPercent || 0));
      let subtotal2 = items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit||0)), 0);

      // apply document discount first (bizMeta.discountPercent)
      const discountPercentUsed = Number(bizMeta.discountPercent || 0);
      const discountAmount = +(subtotal2 * (discountPercentUsed / 100));
      const taxableBase = subtotal2 - discountAmount;

      // apply VAT per-document (bizMeta.vatPercent & bizMeta.applyVat)
      const vatPercentUsed = Number(bizMeta.vatPercent || 0);
      // force applyVat true when a VAT percent > 0 has been set for the document
      const applyVatUsed = (Number(bizMeta.vatPercent || 0) > 0) ? true : ((bizMeta.applyVat === false) ? false : true);
      const vat = applyVatUsed ? +(taxableBase * (vatPercentUsed / 100)) : 0;
      const total = taxableBase + vat;

      // Draw totals with a simple border
      const tx = 400, ty = afterTableY + 10;
      doc.rect(tx - 10, ty - 6, 180, 110).strokeOpacity(0.08).stroke();
      doc.fontSize(10).fillColor("#111").text(`Subtotal: ${formatMoney(subtotal2)}`, tx, ty, { align: "right" });
      doc.fontSize(10).fillColor("#111").text(`Discount (${formatMoney(discountPercentUsed)}%): ${formatMoney(discountAmount)}`, tx, ty + 15, { align: "right" });
      doc.fontSize(10).fillColor("#111").text(`VAT (${formatMoney(vatPercentUsed)}%): ${formatMoney(vat)}`, tx, ty + 30, { align: "right" });
      doc.fontSize(12).fillColor("#000").text(`Total: ${formatMoney(total)}`, tx, ty + 50, { align: "right" });

      if (notes) { doc.moveDown(2); doc.fontSize(10).fillColor("#333").text("Notes:", 50, afterTableY + 80); doc.fontSize(9).fillColor("#444").text(notes, 50, afterTableY + 95, { width: 400 }); }

      doc.fontSize(9).fillColor("gray").text("-----------", 50, 760, { align: "center", width: 500 });

      doc.end();
      stream.on("finish", () => resolve({ filepath, filename, method: "pdfkit" }));
      stream.on("error", (err) => reject(err));
    } catch (err) { reject(err); }
  });

}

/* ---------- Logo saving helpers ---------- */
async function ensureLogosDir() { const logosDir = path.join(process.cwd(), "public", "docs", "logos"); try { await fs.promises.mkdir(logosDir, { recursive: true }); } catch (e) {} return logosDir; }

/**
 * Improved saveLogoFromTwilio:
 * - Detects Twilio account SID embedded in media URL (if present)
 * - Chooses credentials automatically:
 *    - If media URL SID matches TWILIO_BIZ_ACCOUNT_SID -> uses TWILIO_BIZ_AUTH_TOKEN
 *    - Else if matches TWILIO_ACCOUNT_SID -> uses TWILIO_AUTH_TOKEN
 *    - Otherwise prefers TWILIO_BIZ_* then TWILIO_* envs (so subaccount setups work)
 * - Falls back to plain GET for public URLs
 * - Provides clearer error messages when auth is missing/incorrect
 */
async function saveLogoFromTwilio(mediaUrl, businessId) {
  if (!mediaUrl) throw new Error("No media URL");
  const logosDir = await ensureLogosDir();
  const filename = `logo-${businessId}.png`;
  const filepath = path.join(logosDir, filename);

  // Environment credentials
  const envMainSid = process.env.TWILIO_ACCOUNT_SID || null;
  const envMainToken = process.env.TWILIO_AUTH_TOKEN || null;
  const envBizSid = process.env.TWILIO_BIZ_ACCOUNT_SID || null;
  const envBizToken = process.env.TWILIO_BIZ_AUTH_TOKEN || null;

  // Extract account SID if present in the media URL (Twilio API URLs include /Accounts/<SID>/)
  const sidMatch = String(mediaUrl).match(/\/Accounts\/(AC[0-9a-fA-F]{32})\//);
  const accountSidInUrl = sidMatch ? sidMatch[1] : null;

  // Detect twilio API url
  const isTwilioUrl = /:\/\/(api\.)?twilio\.com/i.test(mediaUrl) || /twilio\.com\/2010-04-01/i.test(mediaUrl);

  // Decide which credentials to use
  let useSid = null;
  let useToken = null;

  if (isTwilioUrl) {
    if (accountSidInUrl) {
      // Prefer exact matches first
      if (envBizSid && accountSidInUrl === envBizSid && envBizToken) {
        useSid = envBizSid; useToken = envBizToken;
      } else if (envMainSid && accountSidInUrl === envMainSid && envMainToken) {
        useSid = envMainSid; useToken = envMainToken;
      } else {
        // fallback: try biz then main
        if (envBizSid && envBizToken) { useSid = envBizSid; useToken = envBizToken; }
        else if (envMainSid && envMainToken) { useSid = envMainSid; useToken = envMainToken; }
        else {
          const e = new Error(`Cannot fetch Twilio media: missing TWILIO_BIZ_AUTH_TOKEN or TWILIO_AUTH_TOKEN. Media URL expects account ${accountSidInUrl}.`);
          e.code = "MISSING_TWILIO_AUTH";
          throw e;
        }
      }
    } else {
      // Twilio domain but no SID in URL — pick biz if present, else main
      if (envBizSid && envBizToken) { useSid = envBizSid; useToken = envBizToken; }
      else if (envMainSid && envMainToken) { useSid = envMainSid; useToken = envMainToken; }
      else {
        const e = new Error("Cannot fetch Twilio media: no TWILIO_* credentials found in environment.");
        e.code = "MISSING_TWILIO_AUTH";
        throw e;
      }
    }
  }

  // prepare axios options
  const axiosOpts = {
    responseType: "arraybuffer",
    timeout: 15000,
  };

  if (isTwilioUrl && useSid && useToken) {
    axiosOpts.auth = { username: useSid, password: useToken };
  }

  // Attempt fetch
  let resp;
  try {
    resp = await axios.get(mediaUrl, axiosOpts);
  } catch (err) {
    const status = err?.response?.status || "ERR";
    const twilioErrCode = err?.response?.headers?.["x-twilio-error-code"];
    let message = `Failed to download media from ${mediaUrl} — HTTP ${status}`;
    if (twilioErrCode) message += ` (Twilio error ${twilioErrCode})`;

    if (isTwilioUrl) {
      if (accountSidInUrl && !( (envBizSid && accountSidInUrl === envBizSid) || (envMainSid && accountSidInUrl === envMainSid) )) {
        message += `\nMedia URL belongs to ${accountSidInUrl}. Ensure you have set credentials for that account (TWILIO_BIZ_ACCOUNT_SID / TWILIO_BIZ_AUTH_TOKEN or TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).`;
      } else {
        message += `\nCheck the corresponding TWILIO_* environment variables and ensure the auth token is valid (not revoked).`;
      }
      if (status === 401) message += `\nHint: Twilio returns 401 (error 20003) when credentials are missing/incorrect for that account.`;
    }

    const wrapped = new Error(message);
    wrapped.original = err;
    throw wrapped;
  }

  // save file
  await fs.promises.writeFile(filepath, resp.data);

  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const publicUrl = site ? `${site}/docs/logos/${filename}` : `/docs/logos/${filename}`;
  return { filepath, filename, publicUrl };
}

async function resetSession(biz) { biz.sessionState = null; biz.sessionData = {}; return saveBiz(biz); }

function sendMenu(res) {
  const msg = `ZimQuote | reply with a number:
1) Create business account
2) New invoice
3) New receipt
4) New quotation
5) Add client
6) Upload logo
7) Settings
8) Help

`;
  return sendTwimlText(res, msg);
}

/* ---------- Main webhook (keeps your flow intact) ---------- */
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

    let biz = await Business.findOne({ provider: "whatsapp", providerId });
    if (!biz) {
      biz = await Business.create({
        provider: "whatsapp",
        providerId,
        name: null,
        sessionState: null,
        sessionData: {},
        counters: { invoice: 0, quote: 0, receipt: 0 },
        currency: "USDc",
        invoicePrefix: "INV",
        quotePrefix: "QT",
        receiptPrefix: "RCPT",
        paymentTermsDays: 30,
        // these are business defaults but we won't expose VAT in settings per your request;
        // we still keep defaults so documents can prefill if desired
        taxRate: 15,
        applyTax: true
      });
      console.log("TWILIO (biz): created business record", biz._id?.toString());
    }

    // Ensure sessionData defaults for vat/discount when starting a document
    if (!biz.sessionData) biz.sessionData = {};
    // initialize session-level values when missing
    biz.sessionData.discountPercent = (typeof biz.sessionData.discountPercent === "undefined") ? 0 : biz.sessionData.discountPercent;
    if (typeof biz.sessionData.vatPercent === "undefined") {
      biz.sessionData.vatPercent = Number(biz.taxRate || 0);
    }
    if (typeof biz.sessionData.applyVat === "undefined") {
      biz.sessionData.applyVat = true;
    }

    if (profileName && !biz.name) {
      biz.name = biz.name || profileName;
      await saveBiz(biz).catch(() => {});
    }

    const text = bodyRaw || "";
    const trimmed = text.trim();

    if (trimmed.toLowerCase() === "menu" || trimmed === "0") {
      await resetSession(biz);
      return sendMenu(res);
    }

    if (!biz.name && !biz.sessionState) {
      biz.sessionState = "awaiting_first_choice";
      await saveBiz(biz);
      return sendTwimlText(res, `Welcome to ZimQuote 👋\nQuick setup:\n1) Create business account\n2) Try demo\n3) Help\nReply with a number.`);
    }

    const isSingleNumber = /^\d+$/.test(trimmed);
    const state = biz.sessionState || "idle";

    // Accept numeric top-level commands when state is idle, awaiting_first_choice OR ready.
    if ((state === "idle" || state === "awaiting_first_choice" || state === "ready") && isSingleNumber) {
      const num = trimmed;

      // 2 = invoice, 4 = quote, 3 = receipt (mapping retained)
      if (num === "2" || num === "4" || num === "3") {
        if (!biz.name) {
          biz.sessionState = "awaiting_first_choice";
          await saveBiz(biz);
          return sendTwimlText(res, "You need to create a business first. Reply 1 to create.");
        }
        let docType = "invoice";
        if (num === "4") docType = "quote";
        if (num === "3") docType = "receipt";

        biz.sessionState = "creating_invoice_choose_client";
        biz.sessionData = { items: [], docType, discountPercent: biz.sessionData.discountPercent || 0, vatPercent: biz.sessionData.vatPercent || Number(biz.taxRate || 0), applyVat: typeof biz.sessionData.applyVat === "undefined" ? true : !!biz.sessionData.applyVat };
        await saveBiz(biz);

        const label = docType === "invoice" ? "Invoice" : docType === "quote" ? "Quotation" : "Receipt";
        return sendTwimlText(res, `Create ${label} | pick option:\n1) Use saved client\n2) New client\n3) Cancel`);
      }

      if (num === "1") {
        if (biz.name) return sendTwimlText(res, `You already have a business: "${biz.name}". Reply 7 for settings.`);
        biz.sessionState = "awaiting_business_name";
        biz.sessionData = {};
        await saveBiz(biz);
        return sendTwimlText(res, "Great | what's your business name? (e.g. 'ABC Traders')");
      }

      if (num === "5") {
        if (!biz.name) { biz.sessionState = "awaiting_first_choice"; await saveBiz(biz); return sendTwimlText(res, "You need to create a business first. Reply 1 to create."); }
        biz.sessionState = "adding_client_name";
        biz.sessionData = {};
        await saveBiz(biz);
        return sendTwimlText(res, "Adding client | what's the client name?");
      }

      if (num === "6") {
        biz.sessionState = "awaiting_logo_upload";
        biz.sessionData = {};
        await saveBiz(biz);
        return sendTwimlText(res, "Please send your business logo (as an image). Reply 1 to skip.");
      }

      if (num === "7") {
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

      if (num === "8") {
        return sendTwimlText(res, `Help | reply with numbers only:
1) Create business account
2) New invoice
3) New receipt
4) New quotation
5) Add client
6) Upload logo
7) Settings
8) Help
Type 'menu' to return here anytime.`);
      }

      return sendMenu(res);
    }

    // Onboarding and simple states
    if (state === "awaiting_business_name") {
      const name = trimmed;
      if (!name) return sendTwimlText(res, "Please send a business name (e.g. 'ABC Traders').");
      biz.name = name;
      biz.sessionState = "awaiting_logo_choice";
      await saveBiz(biz);
      return sendTwimlText(res, `Thanks | "${name}".\nSend your logo image now, or reply 1 to skip, 2 to add later.`);
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
        return sendTwimlText(res, "Could not save logo | please send JPG/PNG or reply 1 to skip.");
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
        clients.forEach((c,i)=> lines.push(`${i+1}) ${c.name} | ${c.phone || "no phone"}`));
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
          biz.sessionData.discountPercent = biz.sessionData.discountPercent || 0;
          biz.sessionData.vatPercent = typeof biz.sessionData.vatPercent === "undefined" ? Number(biz.taxRate || 0) : biz.sessionData.vatPercent;
          biz.sessionData.applyVat = typeof biz.sessionData.applyVat === "undefined" ? true : !!biz.sessionData.applyVat;
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
      biz.sessionData.discountPercent = biz.sessionData.discountPercent || 0;
      biz.sessionData.vatPercent = typeof biz.sessionData.vatPercent === "undefined" ? Number(biz.taxRate || 0) : biz.sessionData.vatPercent;
      biz.sessionData.applyVat = typeof biz.sessionData.applyVat === "undefined" ? true : !!biz.sessionData.applyVat;
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
      biz.sessionData.discountPercent = biz.sessionData.discountPercent || 0;
      biz.sessionData.vatPercent = typeof biz.sessionData.vatPercent === "undefined" ? Number(biz.taxRate || 0) : biz.sessionData.vatPercent;
      biz.sessionData.applyVat = typeof biz.sessionData.applyVat === "undefined" ? true : !!biz.sessionData.applyVat;
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

      const isCancel = trimmed === "3" || /(^|\s)(cancel|abort|stop)(\s|$)/.test(lowered);
      const wantsEnterPrices = trimmed === "2" || /(^|\s)(prices|enter prices|enter price|enterprices)(\s|$)/.test(lowered);
      const wantsAddAnother = trimmed === "1";

      // expecting qty if awaitingItemDesc
      if (biz.sessionData.awaitingItemDesc && biz.sessionData.lastItem && (!biz.sessionData.lastItem.qty)) {
        const qty = Number(trimmed);
        if (isNaN(qty) || qty <= 0) {
          if (trimmed === "3") { await resetSession(biz); return sendTwimlText(res, "Cancelled. Reply 'menu' to start again."); }
          return sendTwimlText(res, "Invalid qty. Enter a number like '1' (or '3' to cancel).");
        }
        // store as item (we use item field, description still preserved)
        biz.sessionData.lastItem.qty = qty;
        biz.sessionData.items = biz.sessionData.items || [];
        biz.sessionData.items.push({ item: biz.sessionData.lastItem.description, description: biz.sessionData.lastItem.description, qty: qty, unit: null });
        biz.sessionData.lastItem = null;
        biz.sessionData.awaitingItemDesc = false;
        await saveBiz(biz);
        return sendTwimlText(res, `Item recorded (without price). Total items: ${biz.sessionData.items.length}\nReply:\n1) Add another item\n2) Enter prices for added items\n3) Cancel`);
      }

      if (isCancel) {
        await resetSession(biz);
        return sendTwimlText(res, "Invoice creation cancelled.");
      }

      if (wantsEnterPrices) {
        const itemsArr = biz.sessionData.items || [];
        if (!itemsArr.length) return sendTwimlText(res, "No items added yet. Send an item description first.");
        biz.sessionState = "creating_invoice_enter_prices";
        biz.sessionData.priceIndex = 0;
        biz.sessionData.items = itemsArr;
        await saveBiz(biz);
        const next = biz.sessionData.items[0];
        return sendTwimlText(res, `Price entry: item 1) ${next.item || next.description} x${next.qty}\nEnter unit price (e.g. 450) or reply 'skip' to set 0. Reply 'back' to add more items.`);
      }

      if (wantsAddAnother) {
        biz.sessionData.awaitingItemDesc = false;
        biz.sessionData.lastItem = null;
        await saveBiz(biz);
        return sendTwimlText(res, "Send next item description:");
      }

      if (!biz.sessionData.awaitingItemDesc) {
        const desc = trimmed;
        if (!desc) return sendTwimlText(res, "Send an item description (or reply 2 to enter prices).");
        biz.sessionData.awaitingItemDesc = true;
        biz.sessionData.lastItem = { description: desc };
        await saveBiz(biz);
        return sendTwimlText(res, "Qty? (e.g. 1)");
      }

      return sendTwimlText(res, "Send item description or reply 1/2/3.");
    }

    //
    // Price-entry flow
    //
    if (state === "creating_invoice_enter_prices") {
      const items = biz.sessionData.items || [];
      let idx = Number(biz.sessionData.priceIndex || 0);
      if (!Array.isArray(items) || items.length === 0) {
        biz.sessionState = "creating_invoice_add_items"; biz.sessionData.priceIndex = 0; await saveBiz(biz);
        return sendTwimlText(res, "No items to price. Send item description to add items.");
      }

      const lowered = trimmed.toLowerCase();
      if (lowered === "back") {
        biz.sessionState = "creating_invoice_add_items";
        delete biz.sessionData.priceIndex;
        await saveBiz(biz);
        return sendTwimlText(res, "Back to adding items. Send next item description or reply '2' when ready to enter prices.");
      }

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
        idx += 1;
        biz.sessionData.priceIndex = idx;
        biz.sessionData.items = items;
        await saveBiz(biz);
      }

      if (idx < (biz.sessionData.items || []).length) {
        const next = biz.sessionData.items[idx];
        return sendTwimlText(res, `Price entry: item ${idx+1}) ${next.item || next.description} x${next.qty}\nEnter unit price (e.g. 450) or reply 'skip' to set 0. Reply 'back' to add more items.`);
      }

      // All prices done -> summarize and confirm
      const finalItems = biz.sessionData.items || [];
      const subtotal = finalItems.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit||0)), 0);

      const discountPercent = Number(biz.sessionData.discountPercent || 0);
      const discountAmount = +(subtotal * (discountPercent / 100));
      const taxable = subtotal - discountAmount;
      const vatPercent = Number(biz.sessionData.vatPercent || 0);
      const applyVat = (biz.sessionData.applyVat === false) ? false : true;
      const vatAmount = applyVat ? +(taxable * (vatPercent / 100)) : 0;
      const total = taxable + vatAmount;

      const docType = biz.sessionData.docType || "invoice";
      const label = docType === "invoice" ? "Invoice" : docType === "quote" ? "Quotation" : "Receipt";
      let summary = `${label} summary for ${biz.sessionData.client?.name || biz.sessionData.client?.phone || "client"}:\n`;
      finalItems.forEach((it, i) => summary += `${i+1}) ${it.item || it.description} x${it.qty} @ ${formatMoney(it.unit||0)} = ${formatMoney((it.qty||0)*(it.unit||0))}\n`);
      summary += `Subtotal: ${formatMoney(subtotal)} ${biz.currency || "ZWL"}\n`;
      if (discountPercent && Number(discountPercent) !== 0) summary += `Discount (${formatMoney(discountPercent)}%): -${formatMoney(discountAmount)} ${biz.currency || "ZWL"}\n`;
      summary += applyVat ? `VAT @ ${formatMoney(vatPercent)}%: ${formatMoney(vatAmount)} ${biz.currency || "ZWL"}\n` : `VAT: Not applied\n`;
      summary += `Total: ${formatMoney(total)} ${biz.currency || "ZWL"}\n\n`;
      summary += `1) Add another item
2) Send & generate PDF
3) Cancel
4) Set discount % (current: ${formatMoney(discountPercent)}%)
5) Set VAT % (current: ${formatMoney(vatPercent)}%)`;
      biz.sessionState = "creating_invoice_confirm";
      delete biz.sessionData.priceIndex;
      await saveBiz(biz);
      return sendTwimlText(res, summary);
    }

    //
    // Set VAT state (new) - sets document-level VAT %
    //
    if (state === "creating_invoice_set_vat") {
      // accept "15" or "15%" etc
      const cleaned = String(trimmed || "").replace(/[^0-9.\-]+/g, "").trim();
      const val = parseFloat(cleaned);
      if (isNaN(val) || val < 0) return sendTwimlText(res, "Invalid VAT percent. Send a number like 15 or 15% (use 0 to clear).");
      biz.sessionData.vatPercent = Number(Math.round(val * 100) / 100);
      // ensure applyVat true when user sets a percent
      biz.sessionData.applyVat = true;
      biz.sessionState = "creating_invoice_confirm";
      await saveBiz(biz);
      // Recompute summary quickly to send to user
      const finalItems = biz.sessionData.items || [];
      const subtotal = finalItems.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit||0)), 0);
      const discountPercentNow = Number(biz.sessionData.discountPercent || 0);
      const discountAmountNow = +(subtotal * (discountPercentNow / 100));
      const taxableNow = subtotal - discountAmountNow;
      const vatPercentNow = Number(biz.sessionData.vatPercent || 0);
      const applyVatNow = (biz.sessionData.applyVat === false) ? false : true;
      const vatNow = applyVatNow ? +(taxableNow * (vatPercentNow / 100)) : 0;
      const totalNow = taxableNow + vatNow;

      let summary = `VAT set to ${formatMoney(vatPercentNow)}%.\n`;
      finalItems.forEach((it, i) => summary += `${i+1}) ${it.item || it.description} x${it.qty} @ ${formatMoney(it.unit||0)} = ${formatMoney((it.qty||0)*(it.unit||0))}\n`);
      summary += `Subtotal: ${formatMoney(subtotal)} ${biz.currency || "ZWL"}\n`;
      if (discountPercentNow) summary += `Discount (${formatMoney(discountPercentNow)}%): -${formatMoney(discountAmountNow)} ${biz.currency || "ZWL"}\n`;
      summary += applyVatNow ? `VAT @ ${formatMoney(vatPercentNow)}%: ${formatMoney(vatNow)} ${biz.currency || "ZWL"}\n` : `VAT: Not applied\n`;
      summary += `Total: ${formatMoney(totalNow)} ${biz.currency || "ZWL"}\n\n1) Add another item
2) Send & generate PDF
3) Cancel
4) Set discount % (current: ${formatMoney(discountPercentNow)}%)
5) Set VAT % (current: ${formatMoney(vatPercentNow)}%)`;

      return sendTwimlText(res, summary);
    }

    //
    // Set discount % state (existing)
    //
    if (state === "creating_invoice_set_discount") {
      // accept "10" or "10%" etc
      const cleaned = String(trimmed || "").replace(/[^0-9.\-]+/g, "").trim();
      const val = parseFloat(cleaned);
      if (isNaN(val) || val < 0) return sendTwimlText(res, "Invalid discount. Send a number like 10 or 10% (use 0 to clear).");
      biz.sessionData.discountPercent = Number(Math.round(val * 100) / 100);
      biz.sessionState = "creating_invoice_confirm";
      await saveBiz(biz);
      // Recompute summary quickly to send to user
      const finalItems = biz.sessionData.items || [];
      const subtotal = finalItems.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unit||0)), 0);
      const discountPercent = Number(biz.sessionData.discountPercent || 0);
      const discountAmount = +(subtotal * (discountPercent / 100));
      const taxRate = Number(biz.sessionData.vatPercent || 0);
      const applyTax = (biz.sessionData.applyVat === false) ? false : true;
      const taxable = subtotal - discountAmount;
      const tax = applyTax ? +(taxable * (taxRate / 100)) : 0;
      const total = taxable + tax;

      let summary = `Discount set to ${formatMoney(discountPercent)}%.\n`;
      finalItems.forEach((it, i) => summary += `${i+1}) ${it.item || it.description} x${it.qty} @ ${formatMoney(it.unit||0)} = ${formatMoney((it.qty||0)*(it.unit||0))}\n`);
      summary += `Subtotal: ${formatMoney(subtotal)} ${biz.currency || "ZWL"}\n`;
      if (discountPercent) summary += `Discount (${formatMoney(discountPercent)}%): -${formatMoney(discountAmount)} ${biz.currency || "ZWL"}\n`;
      summary += applyTax ? `VAT @ ${formatMoney(taxRate)}%: ${formatMoney(tax)} ${biz.currency || "ZWL"}\n` : `VAT: Not applied\n`;
      summary += `Total: ${formatMoney(total)} ${biz.currency || "ZWL"}\n\n1) Add another item
2) Send & generate PDF
3) Cancel
4) Set discount % (current: ${formatMoney(discountPercent)}%)
5) Set VAT % (current: ${formatMoney(taxRate)}%)`;

      return sendTwimlText(res, summary);
    }

    //
    // Confirmation: generate invoice/quote/receipt
    //
    if (state === "creating_invoice_confirm" && isSingleNumber) {
      const choice = trimmed;
      if (choice === "1") {
        biz.sessionState = "creating_invoice_add_items";
        await saveBiz(biz);
        return sendTwimlText(res, "Send next item description:");
      }
      if (choice === "3") {
        await resetSession(biz); return sendTwimlText(res, "Cancelled.");
      }
      if (choice === "4") {
        biz.sessionState = "creating_invoice_set_discount";
        await saveBiz(biz);
        return sendTwimlText(res, `Send discount percent (e.g. 10 or 10%). Send 0 to clear discount. Current: ${Number(biz.sessionData.discountPercent||0)}%`);
      }
      if (choice === "5") {
        biz.sessionState = "creating_invoice_set_vat";
        await saveBiz(biz);
        return sendTwimlText(res, `Send VAT percent (e.g. 15 or 15%). Send 0 to clear VAT. Current: ${Number(biz.sessionData.vatPercent||0)}%`);
      }
      if (choice === "2") {
        const items = biz.sessionData.items || [];
        const client = biz.sessionData.client;
        const docType = (biz.sessionData.docType || "invoice"); // "invoice" | "quote" | "receipt"

        biz.counters = biz.counters || { invoice: 0, quote: 0, receipt: 0 };
        const counterKey = docType === "invoice" ? "invoice" : docType === "quote" ? "quote" : "receipt";
        biz.counters[counterKey] = (biz.counters[counterKey] || 0) + 1;

        const prefix = docType === "invoice" ? (biz.invoicePrefix || "INV") : docType === "quote" ? (biz.quotePrefix || "QT") : (biz.receiptPrefix || "RCPT");
        const numberStr = `${prefix}-${String(biz.counters[counterKey]).padStart(6, "0")}`;

        const date = new Date();
        try {
          const { filename } = await generatePDF({
            type: docType === "invoice" ? "invoice" : docType === "quote" ? "quote" : "receipt",
            number: numberStr,
            date,
            dueDate: null,
            billingTo: client?.name || client?.phone,
            email: client?.email || "",
            items,
            notes: "",
            bizMeta: {
              name: biz.name,
              logoUrl: biz.logoUrl,
              address: biz.address || "",
              discountPercent: Number(biz.sessionData.discountPercent || 0),
              vatPercent: Number(biz.sessionData.vatPercent || 0),
              // force applyVat true when a VAT percent > 0 has been set for the document
              applyVat: (Number(biz.sessionData.vatPercent || 0) > 0) ? true : ((biz.sessionData.applyVat === false) ? false : true),
              _id: biz._id?.toString(),
              originalAmount: biz.sessionData.originalAmount || undefined,
              amountPaid: biz.sessionData.amountPaid || undefined,
              currentBalance: biz.sessionData.currentBalance || undefined,
              status: biz.status || undefined
            }
          });
          // save updated counters
          await saveBiz(biz);
          const site = (process.env.SITE_URL || "").replace(/\/$/, "");
          const baseForMedia = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
          const url = `${baseForMedia}/docs/generated/${docType === "invoice" ? "invoices" : docType === "quote" ? "quotes" : "receipts"}/${filename}`;
          await resetSession(biz);
          const label = docType === "invoice" ? "Invoice" : docType === "quote" ? "Quotation" : "Receipt";

          // <-- CHANGED: send only the PDF media with no text body so the download text/link doesn't appear -->
          return sendTwimlWithMedia(res, null, [url]);
        } catch (e) {
          console.error("document PDF failed", e && (e.stack || e.message) ? (e.stack || e.message) : e);
          return sendTwimlText(res, `Failed to generate ${docType} PDF; check server logs.`);
        }
      } else {
        await resetSession(biz); return sendTwimlText(res, "Cancelled.");
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
