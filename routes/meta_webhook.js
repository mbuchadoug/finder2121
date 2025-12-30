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

    const phone = msg.from;

    let text = "";

    // TEXT MESSAGE
    if (msg.type === "text") {
      text = msg.text.body.trim();
    }

    // BUTTON / LIST CLICK
    if (msg.type === "interactive") {
      text =
        msg.interactive?.button_reply?.id ||
        msg.interactive?.list_reply?.id ||
        "";
    }

    // ENTRY MENU TRIGGER
    if (!text || ["hi", "hello", "menu"].includes(text.toLowerCase())) {
      await sendMainMenu(phone);
      return res.sendStatus(200);
    }

    // 🔁 Feed into Twilio engine
    return handleMetaMessage(
      { phone, text },
      req,
      res
    );

  } catch (err) {
    console.error("[META ERROR]", err);
    res.sendStatus(500);
  }
});



export default router;
