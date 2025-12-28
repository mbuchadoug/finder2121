import axios from "axios";

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
