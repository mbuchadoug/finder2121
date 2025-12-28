import Business from "../models/business.js";
import { sendText, sendMainMenu, sendOwnerMenu } from "./metaSender.js";
import { resolveUserState } from "./sessionResolver.js"; // YOUR EXISTING LOGIC

export async function handleIncomingMessage({ from, text }) {
  const biz = await Business.findOne({ phone: from });

  if (!biz) {
    return sendText(from, "❌ You are not registered.");
  }

  // Your existing logic
  await resolveUserState({
    providerId: from,
    message: text,
    business: biz
  });
}
