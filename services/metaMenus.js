// services/metaMenus.js

import { ACTIONS } from "./actions.js";
import { sendList } from "./metaSender.js";

export async function sendOwnerMainMenu(to) {
  return sendList(
    to,
    "📊 Owner Menu",
    "Open menu",
    [
      { id: ACTIONS.NEW_INVOICE, title: "🧾 New Invoice" },
      { id: ACTIONS.ADD_CLIENT, title: "👤 Add Client" },
      { id: ACTIONS.RECORD_PAYMENT, title: "💰 Record Payment" },
      { id: ACTIONS.REPORTS_MENU, title: "📈 Reports" },
      { id: ACTIONS.UPGRADE, title: "🚀 Upgrade" }
    ]
  );
}
