import {
  sendOwnerMainMenu,
  sendDocumentsMenu,
  sendPaymentsMenu,
  sendBusinessMenu
} from "./metaMenus.js";

export async function handleIncomingMessage({ from, action }) {
  console.log("[CHATBOT]", from, action);

  // Entry points
  if (!action || action === "hi" || action === "hello" || action === "menu") {
    return sendOwnerMainMenu(from);
  }

  switch (action) {
    case "documents":
      return sendDocumentsMenu(from);

    case "payments":
      return sendPaymentsMenu(from);

    case "business":
      return sendBusinessMenu(from);

    case "back":
      return sendOwnerMainMenu(from);

    default:
      return sendOwnerMainMenu(from);
  }
}
