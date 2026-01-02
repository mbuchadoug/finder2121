import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import Client from "../models/client.js";
import { sendText } from "./metaSender.js";
import { sendInvoiceConfirmMenu, sendMainMenu } from "./metaMenus.js";
import Invoice from "../models/invoice.js";
import Expense from "../models/expense.js";

import { generatePDF } from "../routes/twilio_biz.js";
import { sendDocument } from "./metaSender.js";
import { sendButtons } from "./metaSender.js";
import { ACTIONS } from "./actions.js";
import { sendList } from "./metaSender.js";

async function saveBizSafe(biz) {
  if (!biz) return;
  biz.markModified("sessionData");
  return biz.save();
}

/**
 * Continue Twilio-style state machine for Meta text input
 */
export async function continueTwilioFlow({ from, text }) {
  const phone = from.replace(/\D+/g, "");
  const session = await UserSession.findOne({ phone });
  if (!session?.activeBusinessId) return false;

  const biz = await Business.findById(session.activeBusinessId);
  if (!biz || !biz.sessionState) return false;

  const trimmed = text.trim();
  const state = biz.sessionState;

  /* ===========================
     🔑 ENSURE CLIENT IS LOADED
     (META RESUME SAFETY)
  ============================ */
  if (!biz.sessionData.client && biz.sessionData.clientId) {
    const client = await Client.findById(biz.sessionData.clientId);
    if (client) {
      biz.sessionData.client = client;
      await saveBizSafe(biz);
    }
  }


/* ===========================
   PAYMENT START (META ENTRY)
=========================== */
if (state === "payment_start") {
  // Tell user what to do next
  await sendText(
    from,
    "💰 Record Payment\n\nReply with the invoice number or type *list* to see unpaid invoices."
  );

  return true;
}



/* ===========================
   EXPENSE: ENTER AMOUNT
=========================== */
if (state === "expense_amount") {
  const amount = Number(trimmed);

  if (isNaN(amount) || amount <= 0) {
    await sendText(from, "❌ Invalid amount. Enter a valid number.");
    return true;
  }

  biz.sessionData.amount = amount;
  biz.sessionState = ACTIONS.EXPENSE_METHOD;
  await saveBizSafe(biz);

 await sendList(
  from,
  "💳 Select payment method",
  [
    { id: "exp_method_cash", title: "Cash" },
    { id: "exp_method_bank", title: "Bank" },
    { id: "exp_method_ecocash", title: "EcoCash" },
    { id: "exp_method_other", title: "Other" }
  ]
);


  return true;
}

/* ===========================
   EXPENSE: CATEGORY
=========================== */
if (state === "expense_category") {
  const categoryMap = {
    "1": "Rent",
    "2": "Utilities",
    "3": "Transport",
    "4": "Supplies",
    "5": "Other"
  };

  const category = categoryMap[trimmed];
  if (!category) {
    await sendText(from, "❌ Invalid option. Choose 1–5.");
    return true;
  }

  biz.sessionData.category = category;
  biz.sessionState = "expense_amount";
  await saveBizSafe(biz);

  await sendText(from, "Enter expense amount:");
  return true;
}


/* ===========================
   EXPENSE: METHOD → SAVE + RECEIPT
=========================== */
if (state === ACTIONS.EXPENSE_METHOD) {
  const methodMap = {
    exp_method_cash: "Cash",
    exp_method_bank: "Bank",
    exp_method_ecocash: "EcoCash",
    exp_method_other: "Other"
  };

  const method = methodMap[text];
  if (!method) {
    await sendText(from, "❌ Invalid method selected.");
    return true;
  }

  const Expense = (await import("../models/expense.js")).default;

  const expense = await Expense.create({
    businessId: biz._id,
    amount: biz.sessionData.amount,
    category: biz.sessionData.category,
    method,
    createdBy: from
  });

  const receiptNumber = `EXP-${expense._id.toString().slice(-6)}`;

  const { filename } = await generatePDF({
    type: "receipt",
    number: receiptNumber,
    date: new Date(),
    billingTo: biz.sessionData.category,
    items: [{
      item: `${biz.sessionData.category} (${method})`,
      qty: 1,
      unit: biz.sessionData.amount,
      total: biz.sessionData.amount
    }],
    bizMeta: {
      name: biz.name,
      logoUrl: biz.logoUrl,
      address: biz.address || "",
      _id: biz._id.toString(),
      status: "paid"
    }
  });

  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const url = `${site}/docs/generated/receipts/${filename}`;

  await sendDocument(from, { link: url, filename });

  biz.sessionState = "ready";
  biz.sessionData = {};
  await saveBizSafe(biz);

  await sendText(from, "✅ Expense recorded successfully.");
  await sendMainMenu(from);
  return true;
}

/* ===========================
   PAYMENT: ENTER AMOUNT
=========================== */
if (state === "payment_amount") {
  const amount = Number(trimmed);

  if (isNaN(amount) || amount <= 0) {
    await sendText(from, "❌ Invalid amount. Enter a number greater than 0.");
    return true;
  }

  const invoice = await Invoice.findById(biz.sessionData.invoiceId);
  if (!invoice) {
    biz.sessionState = "ready";
    biz.sessionData = {};
    await saveBizSafe(biz);
    await sendText(from, "❌ Invoice not found. Returning to menu.");
    await sendMainMenu(from);
    return true;
  }

  if (amount > invoice.balance) {
    await sendText(
      from,
      `❌ Amount exceeds balance.\nBalance: ${invoice.balance} ${invoice.currency}\nEnter a valid amount:`
    );
    return true;
  }

  biz.sessionData.amount = amount;
  biz.sessionState = "payment_method";
  await saveBizSafe(biz);

  await sendText(
    from,
`Payment method:
1) Cash
2) Bank
3) EcoCash
4) Other`
  );

  return true;
}




/* ===========================
   PAYMENT: METHOD → SAVE + RECEIPT
=========================== */
if (state === "payment_method") {
  const methodMap = {
    "1": "Cash",
    "2": "Bank",
    "3": "EcoCash",
    "4": "Other"
  };

  const method = methodMap[trimmed];
  if (!method) {
    await sendText(from, "❌ Invalid option. Choose 1–4.");
    return true;
  }

  const invoice = await Invoice.findById(biz.sessionData.invoiceId);
  if (!invoice) {
    biz.sessionState = "ready";
    biz.sessionData = {};
    await saveBizSafe(biz);
    await sendText(from, "❌ Invoice not found.");
    await sendMainMenu(from);
    return true;
  }

  const amount = biz.sessionData.amount;

  // 💰 UPDATE INVOICE
  invoice.amountPaid += amount;
  invoice.balance -= amount;

  if (invoice.balance <= 0) {
    invoice.status = "paid";
    invoice.balance = 0;
  } else {
    invoice.status = "partial";
  }

  await invoice.save();

  // 🧾 GENERATE RECEIPT
  const receiptNumber = `RCPT-${Date.now()}`;

  const { filename } = await generatePDF({
    type: "receipt",
    number: receiptNumber,
    date: new Date(),
    billingTo: invoice.number,
    items: [{
      item: `Payment (${method})`,
      qty: 1,
      unit: amount,
      total: amount
    }],
    bizMeta: {
      name: biz.name,
      logoUrl: biz.logoUrl,
      address: biz.address || "",
      _id: biz._id.toString(),
      status: invoice.status
    }
  });

  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const url = `${site}/docs/generated/receipts/${filename}`;

  await sendDocument(from, { link: url, filename });

  // ✅ CLEAN EXIT
  biz.sessionState = "ready";
  biz.sessionData = {};
  await saveBizSafe(biz);

  await sendText(
    from,
    `✅ Payment recorded\nInvoice: ${invoice.number}\nAmount: ${amount} ${invoice.currency}\nMethod: ${method}`
  );

  await sendMainMenu(from);
  return true;
}

  /* ===========================
   CLIENT CREATION (MAIN MENU)
=========================== */
if (state === "adding_client_name") {
  biz.sessionData.clientName = trimmed;
  biz.sessionState = "adding_client_phone";
  await saveBizSafe(biz);

  await sendText(
    from,
    "Enter client phone number (or type *same* to use this WhatsApp number):"
  );
  return true;
}

if (state === "adding_client_phone") {
  const phoneVal = trimmed.toLowerCase() === "same" ? phone : trimmed;

  const client = await Client.findOneAndUpdate(
    { businessId: biz._id, phone: phoneVal },
    { $set: { name: biz.sessionData.clientName, phone: phoneVal } },
    { upsert: true, new: true }
  );

  // reset state
   biz.sessionState = "ready";
  biz.sessionData = {};
  await saveBizSafe(biz);

  await sendText(
    from,
    `✅ Client added: ${client.name || client.phone}`
  );

  // 🔁 SHOW MAIN MENU AFTER SUCCESS
  await sendMainMenu(from);

  return true;
}

  /* ===========================
     CLIENT CREATION (INVOICE)
  ============================ */
  if (state === "creating_invoice_new_client") {
    biz.sessionData.clientName = trimmed;
    biz.sessionState = "creating_invoice_new_client_phone";
    await saveBizSafe(biz);

    await sendText(
      from,
      "Enter client phone number (or type *same* to use this WhatsApp number):"
    );
    return true;
  }

  if (state === "creating_invoice_new_client_phone") {
    const phoneVal = trimmed.toLowerCase() === "same" ? phone : trimmed;

    const client = await Client.findOneAndUpdate(
      { businessId: biz._id, phone: phoneVal },
      { $set: { name: biz.sessionData.clientName, phone: phoneVal } },
      { upsert: true, new: true }
    );

    biz.sessionData.client = client;
    biz.sessionData.clientId = client._id; // ✅ CRITICAL FIX
    biz.sessionState = "creating_invoice_add_items";
    biz.sessionData.items = [];
    biz.sessionData.awaitingItemDesc = false;

    await saveBizSafe(biz);

    await sendText(
      from,
      `Client saved: ${client.name || client.phone}\n\nSend item description (e.g. Website design)`
    );
    return true;
  }

  /* ===========================
     ITEM ADDING
  ============================ */
  if (state === "creating_invoice_add_items") {
    if (!biz.sessionData.expectingQty) {
      if (!isNaN(Number(trimmed))) {
        await sendText(from, "Please send an item description (not a number).");
        return true;
      }

      biz.sessionData.lastItem = { description: trimmed };
      biz.sessionData.expectingQty = true;
      await saveBizSafe(biz);

      await sendText(from, "Enter quantity (e.g. 1):");
      return true;
    }

    const qty = Number(trimmed);
    if (isNaN(qty) || qty <= 0) {
      await sendText(from, "Invalid quantity. Enter a number like 1:");
      return true;
    }

    biz.sessionData.items = biz.sessionData.items || [];
    biz.sessionData.items.push({
      item: biz.sessionData.lastItem.description,
      qty,
      unit: 0
    });

    biz.sessionData.lastItem = null;
    biz.sessionData.expectingQty = false;
    biz.sessionState = "creating_invoice_confirm";

    await saveBizSafe(biz);

    await sendButtons(from, "Item added ✅", [
      { id: ACTIONS.INV_ADD_ANOTHER_ITEM, title: "➕ Add another item" },
      { id: ACTIONS.INV_ENTER_PRICES, title: "💰 Enter prices" },
      { id: ACTIONS.INV_CANCEL, title: "❌ Cancel" }
    ]);

    return true;
  }

  /* ===========================
     PRICE ENTRY
  ============================ */
  if (state === "creating_invoice_enter_prices") {
    const price = Number(trimmed);
    if (isNaN(price) || price < 0) {
      await sendText(from, "Invalid price. Enter a number (e.g. 500):");
      return true;
    }

    biz.sessionData.priceIndex = biz.sessionData.priceIndex || 0;
    biz.sessionData.items[biz.sessionData.priceIndex].unit = price;
    biz.sessionData.priceIndex++;

    if (biz.sessionData.priceIndex < biz.sessionData.items.length) {
      await saveBizSafe(biz);
      return sendText(
        from,
        `Enter price for:\n${biz.sessionData.items[biz.sessionData.priceIndex].item}`
      );
    }

    biz.sessionState = "creating_invoice_confirm";
    biz.sessionData.priceIndex = 0;
    await saveBizSafe(biz);

    const summary = biz.sessionData.items
      .map((i, idx) => `${idx + 1}) ${i.item} x${i.qty} @ ${i.unit}`)
      .join("\n");


      
 const docType = biz.sessionData.docType || "invoice";
const label =
  docType === "invoice"
    ? "Invoice"
    : docType === "quote"
    ? "Quotation"
    : "Receipt";

return sendInvoiceConfirmMenu(
  from,
  `🧾 ${label} Summary\n\n${summary}`
);

  }

  /* ===========================
     CONFIRMATION → GENERATE PDF
  ============================ */
  const docType = biz.sessionData.docType || "invoice";

if (state === "creating_invoice_confirm" && trimmed === "2") {
  let client = biz.sessionData.client;

  if (!client && biz.sessionData.clientId) {
    client = await Client.findById(biz.sessionData.clientId);
  }

  if (!client) {
    await sendText(from, "❌ Client information is missing.");
    return true;
  }

  const items = biz.sessionData.items || [];
  if (!items.length) {
    await sendText(from, "❌ No items found.");
    return true;
  }

  const docType = biz.sessionData.docType || "invoice";

  const prefix =
    docType === "invoice"
      ? biz.invoicePrefix || "INV"
      : docType === "quote"
      ? biz.quotePrefix || "QT"
      : biz.receiptPrefix || "RCPT";

  // ✅ increment counter
  biz.counters = biz.counters || { invoice: 0, quote: 0, receipt: 0 };
  const counterKey =
    docType === "invoice"
      ? "invoice"
      : docType === "quote"
      ? "quote"
      : "receipt";

  biz.counters[counterKey] =
    (biz.counters[counterKey] || 0) + 1;

  const number = `${prefix}-${String(biz.counters[counterKey]).padStart(6, "0")}`;

  // ==========================
  // 💾 SAVE INVOICE TO DATABASE
  // ==========================
  const subtotal = items.reduce(
    (s, i) => s + i.qty * i.unit,
    0
  );

  const discountPercent = Number(biz.sessionData.discountPercent || 0);
  const discountAmount = subtotal * (discountPercent / 100);

  const vatPercent = Number(biz.sessionData.vatPercent || 0);
  const applyVat =
    docType === "receipt"
      ? false
      : biz.sessionData.applyVat !== false;

  const vatAmount = applyVat
    ? (subtotal - discountAmount) * (vatPercent / 100)
    : 0;

  const total = subtotal - discountAmount + vatAmount;

  const invoiceDoc = await Invoice.create({
    businessId: biz._id,
    clientId: client._id,
    number,
    currency: biz.currency,

    items: items.map(i => ({
      item: i.item,
      qty: i.qty,
      unit: i.unit,
      total: i.qty * i.unit
    })),

    subtotal,
    discountPercent,
    discountAmount,
    vatPercent,
    vatAmount,
    total,

    amountPaid: 0,
    balance: total,
    status: "unpaid",

    createdBy: from
  });

  // ==========================
  // 📄 GENERATE PDF
  // ==========================
  const { filename } = await generatePDF({
    type: docType,
    number,
    date: new Date(),
    billingTo: client.name || client.phone,
    items,
    bizMeta: {
      name: biz.name,
      logoUrl: biz.logoUrl,
      address: biz.address || "",
      discountPercent,
      vatPercent,
      applyVat,
      _id: biz._id.toString(),
      status: invoiceDoc.status
    }
  });

  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const folder =
    docType === "invoice"
      ? "invoices"
      : docType === "quote"
      ? "quotes"
      : "receipts";

  const url = `${site}/docs/generated/${folder}/${filename}`;

  await sendDocument(from, { link: url, filename });

  biz.sessionState = "ready";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return true;
}


  /* ===========================
     SET DISCOUNT %
  ============================ */
  if (state === "creating_invoice_set_discount") {
    const pct = Number(trimmed);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      await sendText(from, "❌ Invalid discount. Enter a percent (0–100):");
      return true;
    }

    biz.sessionData.discountPercent = pct;
    biz.sessionState = "creating_invoice_confirm";
    await saveBizSafe(biz);

    const summary = biz.sessionData.items
      .map((i, idx) => `${idx + 1}) ${i.item} x${i.qty} @ ${i.unit}`)
      .join("\n");


    const docType = biz.sessionData.docType || "invoice";
const label =
  docType === "invoice"
    ? "Invoice"
    : docType === "quote"
    ? "Quotation"
    : "Receipt";

return sendInvoiceConfirmMenu(
  from,
  `🧾 ${label} Summary\n\n${summary}\n\n💸 Discount: ${pct}%`
);

  }

  /* ===========================
     SET VAT %
  ============================ */
  if (state === "creating_invoice_set_vat") {
    const pct = Number(trimmed);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      await sendText(from, "❌ Invalid VAT. Enter a percent (0–100):");
      return true;
    }

    biz.sessionData.vatPercent = pct;
    biz.sessionData.applyVat = pct > 0;
    biz.sessionState = "creating_invoice_confirm";
    await saveBizSafe(biz);

    const summary = biz.sessionData.items
      .map((i, idx) => `${idx + 1}) ${i.item} x${i.qty} @ ${i.unit}`)
      .join("\n");

    const docType = biz.sessionData.docType || "invoice";
const label =
  docType === "invoice"
    ? "Invoice"
    : docType === "quote"
    ? "Quotation"
    : "Receipt";

return sendInvoiceConfirmMenu(
  from,
  `🧾 ${label} Summary\n\n${summary}\n\n🧾 VAT: ${pct}%`
);

  }

  return false;
}
