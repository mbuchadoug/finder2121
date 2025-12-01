// routes/twilio_webhook.js
import express from "express";
import { Router } from "express";
import twilio from "twilio";
import axios from "axios";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";
import fs from "fs-extra";
import path from "path";
import mustache from "mustache";
import puppeteer from "puppeteer";

import User from "../models/user.js";
import Document from "../models/document.js"; // generic document model (invoice/quote/receipt)
import Counter from "../models/counter.js";   // counter model for seq generation

const router = Router();
router.use(express.urlencoded({ extended: true }));

/* -------------------------
   Utility helpers
   ------------------------- */

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

function toArraySafe(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

// Normalize phone numbers: remove any non-digits and any 'whatsapp:' prefix
function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/^whatsapp:/i, "").replace(/\D+/g, "");
}

/* -------------------------
   Number generator (Counter)
   ------------------------- */
async function nextNumber(type) {
  // type: 'invoice' | 'quote' | 'receipt'
  const now = new Date();
  const y = now.getFullYear();
  const key = `${type}-${y}`;
  const updated = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const seq = String(updated.seq).padStart(3, "0");
  const prefix = type === "invoice" ? "INV" : type === "quote" ? "QUO" : "RCT";
  return `${prefix}${y}${seq}`; // e.g. INV2025001
}

/* -------------------------
   HTML template (mustache)
   ------------------------- */
const TEMPLATE_DOCUMENT_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>{{typeLabel}} {{number}}</title>
<style>
  :root{--accent:#1f6feb;--muted:#666;--panel:#f8f9fb}
  body{font-family:Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; color:#222; padding:28px}
  .wrap{max-width:800px;margin:0 auto;background:#fff;padding:28px;border-radius:8px;box-shadow:0 6px 24px rgba(12,20,40,0.06)}
  header{display:flex;justify-content:space-between;align-items:start}
  .brand{display:flex;gap:12px;align-items:center}
  .brand img{height:56px}
  h1{margin:0;font-size:18px}
  .meta{text-align:right;color:var(--muted)}
  table.lines{width:100%;margin-top:20px;border-collapse:collapse}
  table.lines th, table.lines td{padding:12px;border-bottom:1px solid #eef2f6;text-align:left}
  table.lines th{background:var(--panel);color:#333;font-weight:600}
  .totals{margin-top:18px;display:flex;justify-content:flex-end}
  .totals table{border-collapse:collapse}
  .totals td{padding:6px 12px}
  .accent{color:var(--accent);font-weight:700}
  footer{margin-top:26px;color:var(--muted);font-size:13px}
  .small{font-size:12px;color:var(--muted)}
  .note{background:#fbfdff;border-left:4px solid var(--accent);padding:10px;margin-top:12px;border-radius:4px}
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">
        <img src="{{logoUrl}}" alt="logo" />
        <div>
          <h1>{{companyName}}</h1>
          <div class="small">{{companyAddress}}</div>
        </div>
      </div>
      <div class="meta">
        <div><strong class="accent">{{typeLabel}}</strong></div>
        <div><strong>{{number}}</strong></div>
        <div class="small">Date: {{date}}</div>
        {{#dueDate}}<div class="small">Due: {{dueDate}}</div>{{/dueDate}}
      </div>
    </header>

    <section style="display:flex;justify-content:space-between;margin-top:18px">
      <div>
        <div class="small">Bill To</div>
        <div style="font-weight:600">{{customerName}}</div>
        <div class="small">{{customerEmail}}</div>
      </div>
      <div class="small">
        <div>Document #: <strong>{{number}}</strong></div>
      </div>
    </section>

    <table class="lines">
      <thead>
        <tr><th style="width:60%">Description</th><th style="width:10%">Qty</th><th style="width:15%">Unit</th><th style="width:15%">Amount</th></tr>
      </thead>
      <tbody>
        {{#items}}
        <tr>
          <td>{{description}}</td>
          <td>{{qty}}</td>
          <td>{{unitPrice}}</td>
          <td style="text-align:right">{{lineTotal}}</td>
        </tr>
        {{/items}}
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td class="small">Subtotal</td><td style="text-align:right">{{subtotal}}</td></tr>
        <tr><td class="small">Tax ({{taxRate}}%)</td><td style="text-align:right">{{tax}}</td></tr>
        <tr><td style="font-weight:700">Total</td><td style="text-align:right;font-weight:700">{{total}}</td></tr>
      </table>
    </div>

    {{#notes}}
    <div class="note">{{notes}}</div>
    {{/notes}}

    <footer>
      <div class="small">Bank details: Provide bank details here</div>
      <div class="small">Tax Number: Provide tax number here</div>
    </footer>
  </div>
</body>
</html>`;

/* -------------------------
   PDF helpers (puppeteer)
   ------------------------- */
async function htmlToPdfBuffer(html) {
  // Launch puppeteer; for many server environments disable sandbox
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm" } });
    return pdf;
  } finally {
    await browser.close();
  }
}

async function savePdfBufferToFile(buf, outPath) {
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, buf);
  return outPath;
}

/* -------------------------
   Admin command parsing helpers
   ------------------------- */
function parseAdminCommand(text) {
  // Expect format: "<type> create|... |key:value|item:desc,qty,unit;item2:..."
  // e.g. "invoice create|customer:Acme Ltd|email:bill@acme.com|item:Consulting,2,150;item:Hosting,1,50|due:2025-12-20"
  const parts = String(text || "").split("|").map(s => s.trim()).filter(Boolean);
  const first = (parts[0] || "").toLowerCase();
  const [type, cmd] = first.split(/\s+/); // e.g. ['invoice','create']
  const data = {};
  const items = [];

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const idx = p.indexOf(":");
    if (idx === -1) continue;
    const key = p.slice(0, idx).trim();
    const val = p.slice(idx + 1).trim();
    if (key === "item") {
      // allow multiple items separated by semicolon in same key
      const itemStrs = val.split(";").map(s => s.trim()).filter(Boolean);
      for (const is of itemStrs) {
        const pieces = is.split(",").map(s => s.trim());
        const description = pieces[0] || "";
        const qty = Number(pieces[1] || 1);
        const unit = Number(pieces[2] || 0);
        items.push({ description, qty, unitPrice: unit, lineTotal: (qty * unit).toFixed(2) });
      }
    } else {
      data[key] = val;
    }
  }

  return { type, cmd, data, items };
}

/* -------------------------
   Main webhook route
   ------------------------- */
router.post("/webhook", async (req, res) => {
  console.log("TWILIO: webhook hit ->", { path: req.path, ip: req.ip || req.connection?.remoteAddress });
  console.log("TWILIO: debug env:", {
    SITE_URL: process.env.SITE_URL ? "[set]" : "[missing]",
    DEBUG_TWILIO_SKIP_VERIFY: process.env.DEBUG_TWILIO_SKIP_VERIFY || "[not set]",
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? "[set]" : "[missing]"
  });

  try {
    console.log("TWILIO: body (raw):", JSON.stringify(req.body));
  } catch (e) {
    console.log("TWILIO: body (raw) - keys:", Object.keys(req.body || {}));
  }

  // verify unless debug skip
  if (process.env.DEBUG_TWILIO_SKIP_VERIFY !== "1") {
    try {
      const signature = req.header("x-twilio-signature");
      const authToken = process.env.TWILIO_AUTH_TOKEN;
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
      const ok = twilio.validateRequest(authToken || "", signature, url, params);
      if (!ok) {
        console.warn("TWILIO: request verification failed -> replying 403");
        res.status(403);
        return sendTwimlText(res, "Invalid Twilio signature");
      }
    } catch (e) {
      console.warn("TWILIO: verify error -> replying 403", e && e.message);
      res.status(403);
      return sendTwimlText(res, "Invalid Twilio signature");
    }
  } else {
    console.log("TWILIO_VERIFY: DEBUG skip enabled");
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
    const providerIdNormalized = normalizePhone(providerId);

    // Admin numbers: update this list or move to env var
    const adminNumbers = [
      normalizePhone("+263 789 901 058"),
      normalizePhone("+263 774 716 074")
    ];

    // If admin -> handle admin commands (create/send PDFs)
    if (adminNumbers.includes(providerIdNormalized)) {
      console.log("TWILIO: admin command from", providerId);
      const { type, cmd, data, items } = parseAdminCommand(bodyRaw);

      if (cmd === "create" && ["invoice", "quote", "receipt"].includes(type)) {
        // build items from command; if no items provided for receipt, use amount field as single line
        let docItems = items || [];
        if (type === "receipt" && docItems.length === 0) {
          // receipts can be created with amount:<number>
          const amount = Number(data.amount || data.total || 0);
          docItems = [{ description: data.description || "Payment", qty: 1, unitPrice: amount, lineTotal: amount.toFixed(2) }];
        }

        // compute totals
        const subtotal = docItems.reduce((s, it) => s + (Number(it.qty) * Number(it.unitPrice)), 0);
        const taxRate = Number(data.taxRate || 0);
        const tax = +(subtotal * (taxRate / 100));
        const total = +(subtotal + tax);

        // generate number
        const number = await nextNumber(type).catch((e) => {
          console.error("nextNumber error:", e && e.message);
          throw new Error("Could not generate document number");
        });

        // create DB document
        const doc = await Document.create({
          type,
          number,
          customer: { name: data.customer || data.name || "Customer", email: data.email || "", phone: data.phone || "" },
          date: new Date(),
          dueDate: data.due ? new Date(data.due) : undefined,
          items: docItems.map(it => ({ description: it.description, qty: it.qty, unitPrice: it.unitPrice })),
          subtotal,
          taxRate,
          tax,
          total,
          notes: data.notes || "",
          createdBy: providerId
        });

        // render HTML
        const site = (process.env.SITE_URL || "").replace(/\/$/, "");
        const baseForApi = site || `${(req.get("x-forwarded-proto") || req.protocol)}://${req.get("host")}`;
        const html = mustache.render(TEMPLATE_DOCUMENT_HTML, {
          typeLabel: type === "invoice" ? "Invoice" : type === "quote" ? "Quote" : "Receipt",
          number,
          date: new Date().toLocaleDateString(),
          dueDate: data.due ? new Date(data.due).toLocaleDateString() : "",
          customerName: data.customer || data.name || "Customer",
          customerEmail: data.email || "",
          items: docItems.map(i => ({
            description: i.description,
            qty: i.qty,
            unitPrice: (Number(i.unitPrice) || 0).toFixed(2),
            lineTotal: (Number(i.qty) * Number(i.unitPrice)).toFixed(2)
          })),
          subtotal: subtotal.toFixed(2),
          taxRate,
          tax: tax.toFixed(2),
          total: total.toFixed(2),
          notes: data.notes || "",
          logoUrl: `${baseForApi}/docs/logo.png`,
          companyName: process.env.COMPANY_NAME || "Your Company",
          companyAddress: process.env.COMPANY_ADDRESS || "Company address"
        });

        // generate PDF and save
        const outRel = `/docs/exports/${type}-${number}.pdf`;
        const outPath = path.join(process.cwd(), "public", "docs", "exports", `${type}-${number}.pdf`);
        try {
          const pdfBuf = await htmlToPdfBuffer(html);
          await savePdfBufferToFile(pdfBuf, outPath);
          doc.attachments = [outRel];
          await doc.save();
        } catch (e) {
          console.error("PDF generation error:", e && e.message ? e.message : e);
          return sendTwimlText(res, `Created ${type} ${number} in DB but failed to generate PDF: ${e && e.message ? e.message : e}`);
        }

        // send via Twilio if configured
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_FROM) {
          console.warn("TWILIO REST credentials or TWILIO_WHATSAPP_FROM missing; cannot send message to", providerId);
          return sendTwimlText(res, `${type} ${number} created and saved at ${outRel} (Twilio not configured to send)`);
        }

        const twClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const mediaUrl = `${(process.env.SITE_URL || baseForApi).replace(/\/$/, "")}${outRel}`;
        try {
          await twClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
            to: `whatsapp:${providerId.replace(/\s+/g, "")}`,
            body: `${type.toUpperCase()} ${number} created for ${data.customer || "Customer"}.`,
            mediaUrl: [mediaUrl],
          });
          return sendTwimlText(res, `${type} ${number} created and sent to ${providerId}`);
        } catch (e) {
          console.error("TWILIO send error:", e && (e.message || (e.response && e.response.data)) ? (e.message || JSON.stringify(e.response && e.response.data)) : e);
          return sendTwimlText(res, `${type} ${number} created and available at ${outRel} (failed to send via Twilio)`);
        }
      }

      // If admin message was not a create command, return help for admin usage
      return sendTwimlText(res, "Admin commands:\ninvoice create|customer:Name|email:em@il|item:Desc,qty,unit;item:...|due:YYYY-MM-DD\nquote create|...\nreceipt create|amount:100|description:Payment");
    }

    // Non-admin flow (unchanged from your working code)
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

      const lastPrefs = {
        city: String(city),
        curriculum: Array.isArray(curriculum) ? curriculum.map(String) : toArraySafe(curriculum),
        learningEnvironment: undefined,
        schoolPhase: undefined,
        type2: Array.isArray(type2) ? type2.map(String) : toArraySafe(type2),
        facilities: [],
      };

      try {
        console.log("TWILIO: about to save lastPrefs (type check):", {
          providerId,
          lastPrefsType: typeof lastPrefs,
          lastPrefsIsArray: Array.isArray(lastPrefs),
          lastPrefsPreview: JSON.stringify(lastPrefs).slice(0, 1000)
        });

        await User.findOneAndUpdate(
          { provider: "whatsapp", providerId },
          { $set: { lastPrefs } },
          { new: true, upsert: true }
        );
        console.log("TWILIO: lastPrefs saved for", providerId);
      } catch (e) {
        console.error("TWILIO: failed saving lastPrefs:", e && (e.stack || e.message) ? (e.stack || e.message) : e);
      };

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
          const name = (r.name || "").toLowerCase();
          if (/st[\s-]*eurit/.test(name) || (r.slug && /st-eurit/.test(r.slug))) {
            const registerUrl = "https://skoolfinder.net/register/st-eurit-international-school";
            if (registerUrl) lines.push(`  Register: ${registerUrl}`);
          }
        }
        lines.push("\nReply 'help' for commands.");
        return sendTwimlText(res, lines.join("\n"));
      } catch (e) {
        console.error("TWILIO: recommend call failed:", e && (e.message || (e.response && JSON.stringify(e.response.data))) ? (e.message || JSON.stringify(e.response && e.response.data)) : e);
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
