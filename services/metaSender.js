import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const API = `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`;

const headers = {
  Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
  "Content-Type": "application/json"
};

/* =========================
   BASIC TEXT
========================= */
export async function sendText(to, text) {
  return axios.post(
    API,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    },
    { headers }
  );
}

/* =========================
   BUTTONS
========================= */
export async function sendButtons(to, bodyText, buttons) {
  return axios.post(
    API,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.map(b => ({
            type: "reply",
            reply: {
              id: b.id,
              title: b.title
            }
          }))
        }
      }
    },
    { headers }
  );
}

/* =========================
   LIST (THIS WAS MISSING 🔥)
========================= */
/*export async function sendList(to, bodyText, buttonText, sections) {
  return axios.post(
    API,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections
        }
      }
    },
    { headers }
  );
}*/


// services/metaSender.js

export async function sendList(to, bodyText, rows) {
  if (!Array.isArray(rows)) {
    console.error("❌ sendList rows is not an array:", rows);
    return;
  }

  return axios.post(
    `${process.env.SITE_URL}/${PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: "Select",
          sections: [
            {
              title: "Options",
              rows: rows.map(r => ({
                id: String(r.id),
                title: String(r.title)
              }))
            }
          ]
        }
      }
    },
    { headers }
  );
}


export async function sendDocument(to, document) {
  return axios.post(API, {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document
  }, { headers });
}
