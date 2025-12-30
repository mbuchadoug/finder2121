import { getSession, setSession, clearSession } from "./sessionStore.js";
import { sendText, sendButtons, sendList } from "./metaSender.js";

/**
 * STEP 1 — Choose client
 */
export async function startInvoiceFlow(to) {
  const session = getSession(to) || {};
  session.step = "choose_client";
  session.items = [];

  setSession(to, session);

  return sendList(
    to,
    "📄 *New Invoice*\nSelect a client:",
    "Choose client",
    [
      {
        title: "Clients",
        rows: [
          { id: "client_1", title: "John Doe" },
          { id: "client_2", title: "Acme Corp" },
          { id: "client_new", title: "➕ New client" }
        ]
      }
    ]
  );
}

/**
 * STEP 2 — Client selected
 */
export async function handleClientSelection(to, clientId) {
  const session = getSession(to);

  session.client = clientId;
  session.step = "add_item";

  setSession(to, session);

  return sendButtons(
    to,
    "✅ Client selected\nAdd an item:",
    [
      { id: "item_service", title: "🛠 Service" },
      { id: "item_product", title: "📦 Product" },
      { id: "cancel", title: "❌ Cancel" }
    ]
  );
}

/**
 * STEP 3 — Add item type
 */
export async function handleAddItem(to, itemType) {
  const session = getSession(to);

  session.currentItem = {
    type: itemType,
    qty: 1,
    price: 0
  };

  session.step = "enter_qty";
  setSession(to, session);

  return sendButtons(
    to,
    "Quantity?",
    [
      { id: "qty_1", title: "1" },
      { id: "qty_2", title: "2" },
      { id: "qty_5", title: "5" }
    ]
  );
}

/**
 * STEP 4 — Quantity chosen
 */
export async function handleQty(to, qty) {
  const session = getSession(to);

  session.currentItem.qty = qty;
  session.step = "enter_price";

  setSession(to, session);

  return sendText(to, "Enter unit price (numbers only):");
}

/**
 * STEP 5 — Price entered
 */
export async function handlePrice(to, price) {
  const session = getSession(to);

  session.currentItem.price = price;
  session.items.push(session.currentItem);

  delete session.currentItem;
  session.step = "confirm";

  setSession(to, session);

  const summary = session.items
    .map((i, idx) => `${idx + 1}) ${i.type} × ${i.qty} @ ${i.price}`)
    .join("\n");

  return sendButtons(
    to,
    `🧾 *Invoice summary*\n\n${summary}`,
    [
      { id: "add_more", title: "➕ Add item" },
      { id: "send_invoice", title: "✅ Send invoice" },
      { id: "cancel", title: "❌ Cancel" }
    ]
  );
}

/**
 * FINAL — Send invoice
 */
export async function finalizeInvoice(to) {
  clearSession(to);

  return sendText(
    to,
    "✅ Invoice created successfully.\nReply *menu* to continue."
  );
}
