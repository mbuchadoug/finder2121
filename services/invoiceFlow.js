import axios from "axios";
import { getSession, setSession, clearSession } from "./sessionStore.js";
import { API, headers } from "./metaSender.js";

/**
 * STEP 1 — Choose client
 */
export async function startInvoiceFlow(to) {
  const session = getSession(to);

  session.step = "choose_client";
  session.items = [];

  setSession(to, session);

  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "📄 New Invoice\nSelect a client:" },
      action: {
        button: "Choose client",
        sections: [
          {
            title: "Clients",
            rows: [
              { id: "client_1", title: "John Doe" },
              { id: "client_2", title: "Acme Corp" },
              { id: "client_new", title: "➕ New client" }
            ]
          }
        ]
      }
    }
  }, { headers });
}

/**
 * STEP 2 — Client selected
 */
export async function handleClientSelection(to, clientId) {
  const session = getSession(to);

  session.client = clientId;
  session.step = "add_item";

  setSession(to, session);

  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Client selected ✅\nAdd an item:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "item_service", title: "Service" } },
          { type: "reply", reply: { id: "item_product", title: "Product" } },
          { type: "reply", reply: { id: "cancel", title: "Cancel" } }
        ]
      }
    }
  }, { headers });
}

/**
 * STEP 3 — Add predefined item
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

  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Quantity?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "qty_1", title: "1" } },
          { type: "reply", reply: { id: "qty_2", title: "2" } },
          { type: "reply", reply: { id: "qty_5", title: "5" } }
        ]
      }
    }
  }, { headers });
}

/**
 * STEP 4 — Quantity chosen
 */
export async function handleQty(to, qty) {
  const session = getSession(to);

  session.currentItem.qty = qty;
  session.step = "enter_price";

  setSession(to, session);

  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: "Enter unit price (number only):"
    }
  }, { headers });
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
    .map((i, idx) =>
      `${idx + 1}) ${i.type} x${i.qty} @ ${i.price}`
    )
    .join("\n");

  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: `Invoice summary:\n${summary}`
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "add_more", title: "➕ Add item" } },
          { type: "reply", reply: { id: "send_invoice", title: "✅ Send invoice" } },
          { type: "reply", reply: { id: "cancel", title: "Cancel" } }
        ]
      }
    }
  }, { headers });
}

/**
 * FINAL — Send invoice
 */
export async function finalizeInvoice(to) {
  clearSession(to);

  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: "✅ Invoice created successfully.\nReply *menu* to continue."
    }
  }, { headers });
}
