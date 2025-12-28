import axios from "axios";

const API = `https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`;
const headers = {
  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
  "Content-Type": "application/json"
};

export async function sendText(to, text) {
  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  }, { headers });
}

/* MAIN MENU */
export async function sendMainMenu(to) {
  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Welcome to ZimQuote. Choose an option:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "invoice", title: "📄 New Invoice" } },
          { type: "reply", reply: { id: "receipt", title: "🧾 New Receipt" } },
          { type: "reply", reply: { id: "reports", title: "📊 Reports" } }
        ]
      }
    }
  }, { headers });
}

/* OWNER MENU */
export async function sendOwnerMenu(to) {
  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Owner controls:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "clients", title: "👥 Clients" } },
          { type: "reply", reply: { id: "items", title: "📦 Items" } },
          { type: "reply", reply: { id: "settings", title: "⚙ Settings" } }
        ]
      }
    }
  }, { headers });
}

/* ============================
   STEP B — LIST PICKERS
   ============================ */

/* CLIENT LIST */
export async function sendClientPicker(to, clients) {
  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "Select a client" },
      action: {
        button: "Choose client",
        sections: [{
          title: "Clients",
          rows: clients.map(c => ({
            id: `client_${c._id}`,
            title: c.name,
            description: c.phone || ""
          }))
        }]
      }
    }
  }, { headers });
}

/* ITEM LIST */
export async function sendItemPicker(to, items) {
  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "Select an item" },
      action: {
        button: "Choose item",
        sections: [{
          title: "Items",
          rows: items.map(i => ({
            id: `item_${i._id}`,
            title: i.name,
            description: `$${i.price}`
          }))
        }]
      }
    }
  }, { headers });
}
