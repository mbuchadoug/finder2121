// services/clientFlow.js
import { getSession, setSession } from "./sessionStore.js";
import { sendText } from "./metaSender.js";
import { sendOwnerMainMenu } from "./metaMenus.js";

/**
 * START CLIENT CREATION
 */
export async function startClientFlow(to) {
  const session = getSession(to);

  session.step = "client_name";
  session.newClient = {};

  setSession(to, session);

  return sendText(to, "👤 New Client\n\nEnter client name:");
}

/**
 * HANDLE CLIENT NAME
 */
export async function handleClientName(to, text) {
  const session = getSession(to);

  session.newClient.name = text;
  session.step = "client_phone";

  setSession(to, session);

  return sendText(to, "📞 Enter client phone number:");
}

/**
 * HANDLE CLIENT PHONE
 */
export async function handleClientPhone(to, text) {
  const session = getSession(to);

  session.newClient.phone = text;

  // 🚧 Later: save to DB here
  console.log("[CLIENT SAVED]", session.newClient);

  // Clear client flow but keep session alive
  delete session.newClient;
  session.step = null;

  setSession(to, session);

  return sendOwnerMainMenu(to);
}
