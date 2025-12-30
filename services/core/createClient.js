// services/core/createClient.js
import Client from "../../models/client.js";

export async function createClient({ businessId, name, phone }) {
  return Client.findOneAndUpdate(
    { businessId, phone },
    { name, phone },
    { upsert: true, new: true }
  );
}
