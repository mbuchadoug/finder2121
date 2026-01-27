import Business from "../models/business.js";
import paynow from "../services/paynow.js";

export async function handlePaynowWebhook(req, res) {
  try {
    const { pollurl } = req.body;
    if (!pollurl) return res.sendStatus(200);

    const status = await paynow.pollTransaction(pollurl);

    if (status.status?.toLowerCase() !== "paid") {
      return res.sendStatus(200);
    }

    const reference = status.reference; // SUB_<bizId>_<ts>
    const bizId = reference?.split("_")[1];
    if (!bizId) return res.sendStatus(200);

    const biz = await Business.findById(bizId);
    if (!biz || !biz.sessionData?.targetPackage) {
      return res.sendStatus(200);
    }

    biz.package = biz.sessionData.targetPackage;
    biz.subscriptionStatus = "active";
    biz.sessionState = "ready";
    biz.sessionData = {};

    await biz.save();

    return res.sendStatus(200);
  } catch (err) {
    console.error("Paynow webhook error:", err);
    return res.sendStatus(200);
  }
}
