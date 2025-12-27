import express from "express";
import axios from "axios";

const router = express.Router();

router.post("/send", async (req, res) => {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      return res.status(500).json({
        error: "Missing META_ACCESS_TOKEN or PHONE_NUMBER_ID"
      });
    }

    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        error: "Missing 'to' or 'message' in request body"
      });
    }

    const response = await axios.post(
      `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: message
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error("WhatsApp send error:", error.response?.data || error.message);

    return res.status(500).json({
      error: "WhatsApp send failed",
      details: error.response?.data || error.message
    });
  }
});

export default router;
