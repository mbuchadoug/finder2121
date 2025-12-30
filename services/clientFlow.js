import { getSession, setSession } from "./sessionStore.js";
import { sendText } from "./metaSender.js";

export async function startClientFlow(to) {
  const session = getSession(to);
  session.step = "client_name";
  setSession(to, session);

  return sendText(to, "👤 New Client\n\nEnter client name:");
}

export async function handleClientName(to, name) {
  const session = getSession(to);
  session.newClient = { name };
  session.step = "client_phone";
  setSession(to, session);

  return sendText(to, "📞 Enter client phone number:");
}

export async function handleClientPhone(to, phone) {
  const session = getSession(to);
  session.newClient.phone = phone;

  // TEMP: push into session client list
  session.clients = session.clients || [];
  session.clients.push(session.newClient);

  delete session.newClient;
  session.step = "choose_client";
  setSession(to, session);

  return sendText(
    to,
    "✅ Client added!\nNow continue creating your invoice."
  );
}
