// routes/twilio_webhook.js
import { Router } from "express";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

const router = Router();

/**
 * Always reply with something, no DB, no verification.
 * This is ONLY for testing webhook reachability.
 */

router.post("/webhook", async (req, res) => {
  try {
    console.log("TWILIO TEST WEBHOOK HIT");
    console.log("Headers:", {
      host: req.get("host"),
      "x-forwarded-proto": req.get("x-forwarded-proto"),
      "x-twilio-signature": req.header("x-twilio-signature"),
    });
    console.log("Body:", req.body);

    const body = (req.body.Body || "").trim().toLowerCase();
    const from = req.body.From || "";

    const twiml = new MessagingResponse();

    // Basic test responses
    if (!body) {
      twiml.message(
        "👋 Hey! I received your message — but it was empty.\n\nTry sending:\nhello\nhi\nanything"
      );
    } else if (["hi", "hello", "hey"].includes(body)) {
      twiml.message(
        "👋 Hi there! Your webhook is working perfectly.\n\nSend *anything else* and I'll echo it back."
      );
    } else {
      twiml.message(`🔁 I got your message:\n"${body}"\n\nWebhook is alive!`);
    }

    res.set("Content-Type", "text/xml");
    return res.send(twiml.toString());
  } catch (err) {
    console.error("TWILIO TEST WEBHOOK ERROR:", err);

    // If something fails, send generic TwiML response
    const twiml = new MessagingResponse();
    twiml.message("⚠️ Server error — but your webhook DID reach the server.");

    res.set("Content-Type", "text/xml");
    return res.send(twiml.toString());
  }
});

export default router;
