// routes/paynow.js
import { Router } from "express";
import Business from "../models/business.js";
import { SUBSCRIPTION_PLANS } from "../services/subscriptionPlans.js";
  import { sendText } from "../services/metaSender.js";
const router = Router();

/**
 * 🔔 PAYNOW WEBHOOK
 * Called by Paynow server-to-server
 */
router.post("/webhook", async (req, res) => {
  try {
    console.log("PAYNOW WEBHOOK:", req.body);

    const {
      reference,
      status
    } = req.body;

    if (!reference) {
      return res.status(400).send("Missing reference");
    }

    // example reference: SUB_<bizId>_<timestamp>
    const parts = reference.split("_");
    if (parts.length < 3) {
      return res.status(400).send("Invalid reference");
    }

    const bizId = parts[1];
    const biz = await Business.findById(bizId);

    if (!biz) {
      return res.status(404).send("Business not found");
    }

    // ✅ Only activate on PAID
    if (status === "Paid") {
      const target = biz.sessionData?.targetPackage;
      const plan = SUBSCRIPTION_PLANS[target];

      if (!plan) {
        console.warn("Unknown plan:", target);
        return res.sendStatus(200);
      }

      const now = new Date();

      biz.package = target;
      biz.subscriptionStatus = "active";
      biz.subscriptionStartedAt = now;
      biz.subscriptionEndsAt = new Date(
        now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000
      );

      biz.sessionState = "ready";
      biz.sessionData = {};

      await biz.save();

      console.log(`✅ Subscription activated: ${biz._id} → ${target}`);

    

await sendText(
  biz.ownerPhone,
  `✅ Payment successful!\n\nYour *${target.toUpperCase()}* package is now active.`
);

    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Paynow webhook error:", err);
    res.sendStatus(500);
  }
});

/**
 * 🌍 RETURN URL (user browser / WhatsApp fallback)
 */
router.get("/return", (req, res) => {
  // WhatsApp users usually won’t hit this,
  // but Paynow requires it
  res.send(
    "Payment processing complete. You can return to WhatsApp."
  );
});

export default router;
