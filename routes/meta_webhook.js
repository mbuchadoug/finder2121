import express from "express";
import { dispatchAction } from "../services/actionDispatcher.js";
import { ACTIONS } from "../services/actions.js";
import { getBizContext } from "../services/getBizContext.js";
import { handleIncomingMessage } from "../services/chatbotEngine.js";



import dotenv from "dotenv";


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




router.post("/whatsapp", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    // ✅ ALWAYS ACK META IMMEDIATELY
    res.sendStatus(200);

    if (!msg) return;

    const from = msg.from;
    let action = "";

    // ===========================
    // 🔥 NORMALIZE INPUT HERE
    // ===========================

    if (msg.type === "text") {
      action = (msg.text?.body || "")
        .trim()
        .toLowerCase();
    }

    if (msg.type === "interactive") {
      action = (
        msg.interactive?.button_reply?.id ||
        msg.interactive?.list_reply?.id ||
        ""
      )
        .trim()
        .toLowerCase();
    }

    // 🔥 IMPORTANT: do NOT touch res below this line
    await handleIncomingMessage({ from, action });

  } catch (e) {
    console.error("[META WEBHOOK ERROR]", e);
    // ❌ Do NOT send res here — Meta already got 200
  }
});



export default router;





