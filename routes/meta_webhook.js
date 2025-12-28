import express from "express";
import { handleIncomingMessage } from "../services/chatbotEngine.js";

const router = express.Router();

/**
 * Meta webhook verification
 */
router.get("/webhook", (req, res) => {
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
 * Meta webhook messages
 */
router.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if (!msg) return res.sendStatus(200);

    const from = msg.from; // WhatsApp number
    let text = "";

    if (msg.type === "text") {
      text = msg.text.body.trim();
    }

    if (msg.type === "interactive") {
      text =
        msg.interactive?.button_reply?.id ||
        msg.interactive?.list_reply?.id;
    }

    await handleIncomingMessage({
      from,
      text,
      raw: msg
    });

    res.sendStatus(200);
  } catch (e) {
    console.error("[META WEBHOOK ERROR]", e);
    res.sendStatus(500);
  }
});

export default router;
