import { sendOwnerMainMenu } from "./metaMenus.js";

export async function handleIncomingMessage({ from, action }) {
  console.log("[CHATBOT]", from, action);

  // Entry points
  if (
    action === "hi" ||
    action === "hello" ||
    action === "menu" ||
    action === ""
  ) {
    return sendOwnerMainMenu(from);
  }

  // Navigation (for now just log)
  switch (action) {
    case "documents":
    case "payments":
    case "business":
      return sendOwnerMainMenu(from);

    default:
      return sendOwnerMainMenu(from);
  }
}
