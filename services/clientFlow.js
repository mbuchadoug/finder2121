import Client from "../models/client.js";
import { getSession, setSession } from "./sessionStore.js";
import { sendText, sendButtons } from "./metaSender.js";

export async function startClientFlow(from) {
  const session = getSession(from);
  session.step = "client_name";
  setSession(from, session);

  return sendText(from, "Enter client name:");
}

export async function handleClientName(from, name) {
  const session = getSession(from);
  session.clientName = name;
  session.step = "client_phone";
  setSession(from, session);

  return sendText(from, "Enter client phone number:");
}

export async function handleClientPhone(from, phone) {
  const session = getSession(from);

  const client = await Client.create({
    businessId: session.businessId,
    name: session.clientName,
    phone
  });

  // 🔑 CRITICAL PART
  session.clientId = client._id;
  session.step = "add_item";

  delete session.clientName;
  setSession(from, session);

  return sendButtons(from, {
    body: `Client *${client.name}* added.\nAdd an item:`,
    buttons: [
      { id: "item_service", title: "Service" },
      { id: "item_product", title: "Product" },
      { id: "cancel", title: "Cancel" }
    ]
  });
}
