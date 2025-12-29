import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API = `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`;
const headers = {
  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
  "Content-Type": "application/json"
};

/**
 * ✅ OWNER MAIN MENU
 */
export async function sendOwnerMainMenu(to) {
  return axios.post(
    API,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: "👋 Welcome to ZimQuote\n\nWhat would you like to do?"
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "documents", title: "📄 Documents" }
            },
            {
              type: "reply",
              reply: { id: "payments", title: "💰 Payments" }
            },
            {
              type: "reply",
              reply: { id: "business", title: "⚙️ Business" }
            }
          ]
        }
      }
    },
    { headers }
  );
}

/**
 * 📄 DOCUMENTS MENU
 */
export async function sendDocumentsMenu(to) {
  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "📄 Documents\nChoose an action:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "new_invoice", title: "New Invoice" } },
          { type: "reply", reply: { id: "new_receipt", title: "New Receipt" } },
          { type: "reply", reply: { id: "back", title: "⬅ Back" } }
        ]
      }
    }
  }, { headers });
}

/**
 * 💰 PAYMENTS MENU
 */
export async function sendPaymentsMenu(to) {
  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "💰 Payments\nChoose an action:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "record_payment", title: "Record Payment" } },
          { type: "reply", reply: { id: "expenses", title: "Expenses" } },
          { type: "reply", reply: { id: "back", title: "⬅ Back" } }
        ]
      }
    }
  }, { headers });
}

/**
 * ⚙️ BUSINESS MENU
 */
export async function sendBusinessMenu(to) {
  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "⚙️ Business Settings" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "clients", title: "Clients" } },
          { type: "reply", reply: { id: "items", title: "Items" } },
          { type: "reply", reply: { id: "upgrade", title: "Upgrade" } }
        ]
      }
    }
  }, { headers });
}
