// routes/meta_webhook.js
import express from "express";
import axios from "axios";

const router = express.Router();

// Meta sends JSON
router.use(express.json());

/**
 * ===============================
 * WEBHOOK VERIFICATION (GET)
 * ===============================
 * URL Meta will call:
 *   GET /meta/whatsapp
 */
router.get("/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    console.log("✅ WhatsApp webhook verified");
    return res.status(200).send(challenge);
  }

  console.warn("❌ WhatsApp webhook verification failed");
  return res.sendStatus(403);
});

/**
 * ===============================
 * RECEIVE MESSAGES (POST)
 * ===============================
 * URL Meta will call:
 *   POST /meta/whatsapp
 */
router.post("/whatsapp", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const message = value?.messages?.[0];

    // Meta expects 200 even if no message
    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from; // User phone number (international format)
    const text = message.text?.body?.trim() || "";

    console.log("📩 Incoming WhatsApp message");
    console.log("From:", from);
    console.log("Text:", text);

    // ===============================
    // SIMPLE BOT LOGIC (EDIT LATER)
    // ===============================
    let reply =
      "Welcome to ZimEduFinder 👋\n\n" +
      "1️⃣ Find a school\n" +
      "2️⃣ Talk to support";

    if (text === "1") {
      reply =
        "🏫 Find a School\n\n" +
        "Reply with:\n" +
        "A) Harare\n" +
        "B) Bulawayo\n" +
        "C) Other towns";
    }

    if (text === "2") {
      reply =
        "📞 Support\n\n" +
        "Our team will assist you shortly.";
    }

    await sendWhatsAppText(from, reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error(
      "❌ WhatsApp webhook error:",
      err.response?.data || err.message
    );
    return res.sendStatus(500);
  }
});

/**
 * ===============================
 * SEND WHATSAPP MESSAGE
 * ===============================
 */
async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

export default router;
