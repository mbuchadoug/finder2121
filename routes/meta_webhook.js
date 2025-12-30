import express from "express";
import dotenv from "dotenv";
//import { handleIncomingMessage } from "../services/chatbotEngine.js";
import { handleMetaMessage } from "../services/unifiedWhatsAppEngine.js";
import { sendMainMenu } from "../services/metaMenus.js";

dotenv.config();
const router = express.Router();

/**
 * ✅ Meta webhook verification
 */
router.get("/whatsapp", (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/**
 * ✅ Incoming messages from WhatsApp
 */


router.post("/meta/whatsapp", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from;

    // 🔥 DIRECT SEND (NO MENU, NO ENGINE)
    const axios = (await import("axios")).default;

    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: "✅ Webhook is working" }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.sendStatus(200);

  } catch (e) {
    console.error("META SEND ERROR:", e.response?.data || e.message);
    return res.sendStatus(500);
  }
});



export default router;
