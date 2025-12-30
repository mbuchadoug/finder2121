import { ACTIONS } from "./actions.js";
import { sendList, sendButtons } from "./metaSender.js";

export async function sendMainMenu(to) {
  return sendList(to, "📊 Main Menu", [
    { id: ACTIONS.SALES_MENU, title: "🧾 Sales" },
    { id: ACTIONS.CLIENTS_MENU, title: "👥 Clients" },
    { id: ACTIONS.PAYMENTS_MENU, title: "💰 Payments" },
    { id: ACTIONS.REPORTS_MENU, title: "📈 Reports" },
    { id: ACTIONS.BUSINESS_MENU, title: "🏢 Business & Users" },
    { id: ACTIONS.SETTINGS_MENU, title: "⚙ Settings" }
  ]);
}

/* =========================
   SALES
   ========================= */
export async function sendSalesMenu(to) {
  return sendButtons(to, "🧾 Sales", [
    { id: ACTIONS.NEW_INVOICE, title: "New Invoice" },
    { id: ACTIONS.NEW_QUOTE, title: "New Quotation" },
    { id: ACTIONS.NEW_RECEIPT, title: "New Receipt" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   CLIENTS
   ========================= */
export async function sendClientsMenu(to) {
  return sendButtons(to, "👥 Clients", [
    { id: ACTIONS.ADD_CLIENT, title: "➕ Add Client" },
    { id: ACTIONS.CLIENT_STATEMENT, title: "📄 Client Statement" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   PAYMENTS
   ========================= */
export async function sendPaymentsMenu(to) {
  return sendButtons(to, "💰 Payments", [
    { id: ACTIONS.RECORD_PAYMENT, title: "Record Payment" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   BUSINESS
   ========================= */
export async function sendBusinessMenu(to) {
  return sendButtons(to, "🏢 Business & Users", [
    { id: ACTIONS.BUSINESS_PROFILE, title: "Business Profile" },
    { id: ACTIONS.USERS, title: "Users" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   SETTINGS
   ========================= */
export async function sendSettingsMenu(to) {
  return sendButtons(to, "⚙ Settings", [
    { id: ACTIONS.UPGRADE, title: "🚀 Upgrade Plan" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}
