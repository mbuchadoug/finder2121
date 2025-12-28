import express from "express";
import axios from "axios";

const router = express.Router();

/**
 * Register WhatsApp business phone number
 * Sets the 6-digit two-step verification PIN
 */
router.post("/register", async (req, res) => {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      return res.status(500).json({
        error: "Missing META_ACCESS_TOKEN or PHONE_NUMBER_ID"
      });
    }

    const { pin } = req.body;

    if (!pin || !/^\d{6}$/.test(pin)) {
      return res.status(400).json({
        error: "PIN is required and must be a 6-digit number"
      });
    }

    const response = await axios.post(
      `https://graph.facebook.com/v24.0/${phoneNumberId}`,
      { pin },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.json({
      success: true,
      message: "WhatsApp phone number registered successfully",
      data: response.data
    });

  } catch (error) {
    console.error(
      "WhatsApp register error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      error: "WhatsApp registration failed",
      details: error.response?.data || error.message
    });
  }
});

export default router;
