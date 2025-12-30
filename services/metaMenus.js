import { ACTIONS } from "./actions.js";
import { sendButtons } from "./metaSender.js";

/* =========================
   MAIN MENU
========================= */
export function sendMainMenu(to) {
  return sendButtons(to, "📊 Main Menu", [
    { id: ACTIONS.SALES_MENU, title: "🧾 Sales" },
    { id: ACTIONS.CLIENTS_MENU, title: "👥 Clients" },
    { id: ACTIONS.PAYMENTS_MENU, title: "💰 Payments" },
    { id: ACTIONS.REPORTS_MENU, title: "📈 Reports" },
    { id: ACTIONS.BUSINESS_MENU, title: "🏢 Business & Users" },
    { id: ACTIONS.SETTINGS_MENU, title: "⚙ Settings" }
  ]);
}

/* =========================
   SALES MENU  (STEP 3A)
========================= */
export function sendSalesMenu(to) {
  return sendButtons(to, "🧾 Sales", [
    { id: ACTIONS.NEW_INVOICE, title: "New Invoice" },
    { id: ACTIONS.NEW_QUOTE, title: "New Quotation" },
    { id: ACTIONS.NEW_RECEIPT, title: "New Receipt" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   CLIENTS MENU (STEP 3B)
========================= */
export function sendClientsMenu(to) {
  return sendButtons(to, "👥 Clients", [
    { id: ACTIONS.ADD_CLIENT, title: "Add Client" },
    { id: ACTIONS.CLIENT_STATEMENT, title: "Client Statement" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   PAYMENTS MENU (STEP 3C)
========================= */
export function sendPaymentsMenu(to) {
  return sendButtons(to, "💰 Payments", [
    { id: ACTIONS.RECORD_PAYMENT, title: "Record Payment" },
    { id: ACTIONS.RECORD_EXPENSE, title: "Record Expense" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   BUSINESS MENU
========================= */
export function sendBusinessMenu(to) {
  return sendButtons(to, "🏢 Business & Users", [
    { id: "create_business", title: "Create Business" },
    { id: "invite_user", title: "Invite User" },
    { id: "upload_logo", title: "Upload Logo" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   SETTINGS MENU
========================= */
export function sendSettingsMenu(to) {
  return sendButtons(to, "⚙ Settings", [
    { id: "currency", title: "Currency" },
    { id: "payment_terms", title: "Payment Terms" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}
