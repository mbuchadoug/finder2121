// routes/paynow.js
import { Router } from "express";
import Business from "../models/business.js";
import { SUBSCRIPTION_PLANS } from "../services/subscriptionPlans.js";
  import { sendText } from "../services/metaSender.js";
  import paynow from "../services/paynow.js";

const router = Router();

/**
 * 🔔 PAYNOW WEBHOOK
 * Called by Paynow server-to-server
 */
router.post("/webhook", async (req, res) => {
  try {
    console.log("🔔 PAYNOW WEBHOOK RAW:", req.body);

    // Paynow sends poll URL, not payment status
    const pollUrl =
      req.body?.pollurl ||
      req.body?.pollUrl ||
      req.body?.poll_url;

    if (!pollUrl) {
      console.warn("⚠️ Paynow webhook without pollUrl");
      return res.sendStatus(200);
    }

    // 🔁 Poll Paynow for the REAL status
    const status = await paynow.pollTransaction(pollUrl);
    console.log("📡 PAYNOW POLL RESULT:", status);

    if (!status || status.status?.toLowerCase() !== "paid") {
      return res.sendStatus(200);
    }

    const reference = status.reference;
    if (!reference || !reference.startsWith("SUB_")) {
      return res.sendStatus(200);
    }

    // SUB_<bizId>_<timestamp>
    const bizId = reference.split("_")[1];
    if (!bizId) return res.sendStatus(200);

    const biz = await Business.findById(bizId);
    if (!biz || !biz.sessionData?.targetPackage) {
      return res.sendStatus(200);
    }

    const target = biz.sessionData.targetPackage;
    const plan = SUBSCRIPTION_PLANS[target];
    if (!plan) return res.sendStatus(200);

    const now = new Date();

    // ✅ ACTIVATE SUBSCRIPTION
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
      `✅ Payment successful!\n\nYour *${target.toUpperCase()}* package is now active 🎉`
    );

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Paynow webhook error:", err);
    return res.sendStatus(200);
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
