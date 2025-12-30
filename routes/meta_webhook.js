import express from "express";
import { dispatchAction } from "../services/actionDispatcher.js";
import { ACTIONS } from "../services/actions.js";
import { getBizContext } from "../services/getBizContext.js";



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
  const entry = req.body.entry?.[0];
  const msg = entry?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);

  const providerId = msg.from;
  const action =
    msg.interactive?.button_reply?.id ||
    msg.interactive?.list_reply?.id ||
    ACTIONS.MENU;

  const { biz, helpers } = await getBizContext(req, res, providerId);
  if (!biz) return res.sendStatus(200);

  await dispatchAction({
    action,
    biz,
    providerId,
    req,
    res,
    helpers
  });

  return res.sendStatus(200);
});

export default router;





