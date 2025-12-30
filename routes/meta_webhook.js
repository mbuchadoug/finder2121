import express from "express";
import { dispatchAction } from "../services/actionDispatcher.js";
import { ACTIONS } from "../services/actions.js";
import { getBizContext } from "../services/getBizContext.js";
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

    // ✅ Always ACK Meta immediately
    res.sendStatus(200);

    // Nothing to process
    if (!msg) return;

    const from = msg.from;
    let action = "";

    if (msg.type === "text") {
      action = msg.text.body.trim();
    }

    if (msg.type === "interactive") {
      action =
        msg.interactive?.button_reply?.id ||
        msg.interactive?.list_reply?.id ||
        "";
    }

    // 🔥 IMPORTANT: NO res usage below this line
    await handleIncomingMessage({ from, action });

  } catch (e) {
    console.error("[META WEBHOOK ERROR]", e);
    // ❌ DO NOT res.send here — Meta already got 200
  }
});


export default router;





