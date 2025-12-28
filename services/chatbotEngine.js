import { sendMainMenu } from "./metaSender.js";

export async function handleIncomingMessage({ from, text }) {
  console.log("[META CHATBOT]", from, text);

  // TEMP: always show menu (we’ll add routing after)
  await sendMainMenu(from);
}
