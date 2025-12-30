import { sendList } from "./metaSender.js";

export function sendMainMenu(to) {
  return sendList(to, "📋 ZimQuote Menu", "Choose action", [
    {
      title: "🧾 Sales",
      rows: [
        { id: "invoice", title: "New Invoice" },
        { id: "receipt", title: "New Receipt" },
        { id: "quote", title: "New Quotation" }
      ]
    },
    {
      title: "👥 Clients & Payments",
      rows: [
        { id: "add_client", title: "Add Client" },
        { id: "payment", title: "Record Payment" },
        { id: "expense", title: "Record Expense" },
        { id: "statement", title: "Client Statement" }
      ]
    },
    {
      title: "🏢 Business & System",
      rows: [
        { id: "reports_menu", title: "Reports" },
        { id: "invite_user", title: "Invite User" },
        { id: "upload_logo", title: "Upload Logo" },
        { id: "settings", title: "Settings" },
        { id: "upgrade_plan", title: "Upgrade Plan" }
      ]
    }
  ]);
}
