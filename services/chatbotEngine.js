
//import { resolveUserState } from "./sessionResolver.js"; // YOUR EXISTING LOGIC


import { resolveUserState } from "./sessionResolver.js";


import { sendText } from "./metaSender.js";

export async function handleIncomingMessage({ from, text }) {
  console.log("[CHATBOT] incoming:", from, text);

  // TEMP TEST RESPONSE
  await sendText(
    from,
    `👋 Hi! I received: "${text}"`
  );
}


/*export async function handleIncomingMessage({ from, text }) {
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
}*/
