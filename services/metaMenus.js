import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const API = `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`;
const headers = {
  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
  "Content-Type": "application/json"
};

export async function sendMainMenu(to) {
  return axios.post(
    API,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "ZimQuote Main Menu" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "2", title: "🧾 New Invoice" } },
            { type: "reply", reply: { id: "5", title: "👤 Add Client" } },
            { type: "reply", reply: { id: "8", title: "📊 Reports" } }
          ]
        }
      }
    },
    { headers }
  );
}
