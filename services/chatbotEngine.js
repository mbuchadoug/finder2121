import dotenv from "dotenv";
dotenv.config();

import { resolveUserState } from "./sessionResolver.js";
import { sendMainMenu } from "./metaSender.js"; // ✅ FIXED

export async function handleIncomingMessage({ from, text }) {
  console.log("[CHATBOT] incoming:", from, text);

  await sendMainMenu(from); // ✅ now works
}
