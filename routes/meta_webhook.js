import express from "express";
const router = express.Router();

// webhook verification
router.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// receive messages + FLOW submissions
router.post("/webhook", express.json(), async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;

    // FLOW SUBMISSION
    if (change?.messages?.[0]?.type === "interactive") {
      const interactive = change.messages[0].interactive;

      if (interactive.type === "flow") {
        const flowData = interactive.flow?.data;

        console.log("FLOW SUBMITTED:", flowData);

        /*
          Example flowData you’ll receive:
          {
            school_level: "Primary",
            city: "Harare",
            budget: "500-1000",
            facilities: ["scienceLabs","computerLab"]
          }
        */

        // 👉 call your existing recommendation logic
        // same logic used in /api/recommend
      }
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("META WEBHOOK ERROR:", e);
    return res.sendStatus(200);
  }
});

export default router;
