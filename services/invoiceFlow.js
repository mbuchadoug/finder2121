// services/invoiceFlow.js
import { getSession, setSession, clearSession } from "./sessionStore.js";
import { sendText } from "./metaSender.js";
import { sendOwnerMainMenu } from "./metaMenus.js";

/**
 * START INVOICE FLOW
 */
export async function startInvoiceFlow(to) {
  const session = getSession(to);

  session.step = "choose_client";
  session.invoice = {
    client: null,
    items: []
  };

  setSession(to, session);

  return sendText(
    to,
    "📄 New Invoice\n\nChoose a client:\n\n1️⃣ John Doe\n2️⃣ Acme Corp\n➕ Type *new* to add client"
  );
}

/**
 * CLIENT SELECTED
 */
export async function handleClientSelection(to, clientId) {
  const session = getSession(to);

  session.invoice.client = clientId;
  session.step = "add_item";

  setSession(to, session);

  return sendText(
    to,
    "✅ Client selected\n\nType *service* or *product* to add item"
  );
}

/**
 * ADD ITEM
 */
export async function handleAddItem(to, type) {
  const session = getSession(to);

  session.currentItem = { type, qty: 1, price: 0 };
  session.step = "enter_qty";

  setSession(to, session);

  return sendText(to, "Enter quantity (number):");
}

/**
 * HANDLE QTY
 */
export async function handleQty(to, qty) {
  const session = getSession(to);

  session.currentItem.qty = qty;
  session.step = "enter_price";

  setSession(to, session);

  return sendText(to, "Enter unit price:");
}

/**
 * HANDLE PRICE
 */
export async function handlePrice(to, price) {
  const session = getSession(to);

  session.currentItem.price = price;
  session.invoice.items.push(session.currentItem);

  delete session.currentItem;
  session.step = "confirm";

  setSession(to, session);

  const summary = session.invoice.items
    .map(
      (i, idx) =>
        `${idx + 1}) ${i.type} x${i.qty} @ ${i.price}`
    )
    .join("\n");

  return sendText(
    to,
    `🧾 Invoice Summary\n\n${summary}\n\nType *send* to finish or *add* to add item`
  );
}

/**
 * FINALIZE
 */
export async function finalizeInvoice(to) {
  const session = getSession(to);

  console.log("[INVOICE CREATED]", session.invoice);

  clearSession(to);

  return sendOwnerMainMenu(to);
}
