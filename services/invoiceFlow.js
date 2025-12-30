import { getSession, setSession, clearSession } from "./sessionStore.js";
import { sendText, sendButtons, sendList } from "./metaSender.js";

import { createDraftInvoice } from "./core/createDraftInvoice.js";
import { addInvoiceItem } from "./core/addInvoiceItem.js";
import { finalizeInvoice as finalize } from "./core/finalizeInvoice.js";

/* STEP 1 — start */
export async function startInvoiceFlow(from) {
  const session = getSession(from);

  session.items = [];
  session.step = "choose_client";

  setSession(from, session);

  return sendList(from, {
    body: "📄 New Invoice\nSelect a client:",
    button: "Clients",
    rows: [
      { id: "client_1", title: "John Doe" },
      { id: "client_2", title: "Acme Corp" },
      { id: "client_new", title: "➕ New Client" }
    ]
  });
}


/* STEP 2 — client selected */
export async function handleClientSelection(from, clientId) {
  const session = getSession(from);

  session.clientId = clientId;
  session.step = "add_item";
  setSession(from, session);

  return sendButtons(from, {
    body: "Add item",
    buttons: [
      { id: "item_service", title: "Service" },
      { id: "item_product", title: "Product" }
    ]
  });
}

/* STEP 3 — qty */
export async function handleQty(from, qty) {
  const session = getSession(from);

  session.currentItem.qty = qty;
  session.step = "enter_price";
  setSession(from, session);

  return sendText(from, "Enter price:");
}

/* STEP 4 — price */
export async function handlePrice(from, price) {
  const session = getSession(from);

  await addInvoiceItem(session.invoiceId, {
    ...session.currentItem,
    price
  });

  session.step = "confirm";
  delete session.currentItem;
  setSession(from, session);

  return sendButtons(from, {
    body: "Item added",
    buttons: [
      { id: "add_more", title: "➕ Add item" },
      { id: "send_invoice", title: "✅ Send invoice" }
    ]
  });
}

/* FINAL */
export async function finalizeInvoice(from) {
  const session = getSession(from);

  const { pdfUrl } = await finalize(session.invoiceId);
  clearSession(from);

  return sendText(from, `✅ Invoice sent\n${pdfUrl}`);
}
