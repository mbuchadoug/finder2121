import express from "express";
import dotenv from "dotenv";
import { handleIncomingMessage } from "../services/chatbotEngine.js";
import { handleMetaMessage } from "../services/unifiedWhatsAppEngine.js";

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

    const message = value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const phone = message.from;
    const text =
      message.text?.body ||
      message.button?.text ||
      message.interactive?.button_reply?.id ||
      message.interactive?.list_reply?.id ||
      "";

    const mediaUrls = [];

    if (message.image?.id) {
      // you can expand this later
    }

    return handleMetaMessage(
      { phone, text, mediaUrls },
      req,
      res
    );

  } catch (err) {
    console.error("[META ERROR]", err);
    res.sendStatus(500);
  }
});


export default router;
