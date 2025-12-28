import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
console.log("[ENV RUNTIME CHECK]", {
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
  META_TOKEN: process.env.META_TOKEN,
  WABA_ID: process.env.WABA_ID,
  META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID
});

export async function sendMetaMessage({ to, text }) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WABA_ID}/messages`;

  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}
