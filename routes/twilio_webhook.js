// routes/twilio_webhook.js
import { Router } from "express";
import express from "express";
import MessagingResponse from "twilio/lib/twiml/MessagingResponse.js";

const router = Router();

// Use urlencoded for *this route only* to guarantee parsing regardless of global middleware order
const urlencoded = express.urlencoded({ extended: true });

router.post("/webhook", urlencoded, (req, res) => {
  try {
    console.log("TWILIO TEST WEBHOOK HIT");
    console.log("Headers:", {
      host: req.get("host"),
      "x-forwarded-proto": req.get("x-forwarded-proto"),
      "x-twilio-signature": req.header("x-twilio-signature"),
      "content-type": req.get("content-type"),
    });
    console.log("Raw body object:", req.body);

    // tolerate either Body / body / text
    const rawBody = (req.body.Body || req.body.body || req.body.message || "").toString();
    const body = rawBody.trim().toLowerCase();
    const from = req.body.From || req.body.from || "";

    const twiml = new MessagingResponse();

    if (!body) {
      twiml.message(
        "👋 Received your request but it looked empty. Try sending: 'hi' or 'find harare'"
      );
    } else if (["hi", "hello", "hey"].includes(body)) {
      twiml.message("👋 Hi! Webhook reached the server and replied successfully.");
    } else {
      twiml.message(`🔁 Echo: "${rawBody}"\n\nWebhook is alive and responding.`);
    }

    res.set("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  } catch (err) {
    console.error("TWILIO TEST WEBHOOK ERROR:", err && (err.stack || err));
    try {
      const twiml = new MessagingResponse();
      twiml.message("⚠️ Server error but webhook reached the server.");
      res.set("Content-Type", "text/xml");
      return res.status(500).send(twiml.toString());
    } catch (e) {
      // last resort
      res.status(500).send("server error");
    }
  }
});

export default router;
