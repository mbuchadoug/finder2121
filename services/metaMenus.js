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
