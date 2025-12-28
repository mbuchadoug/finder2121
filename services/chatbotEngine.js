import { MENUS } from "./menuSchema.js";
import { renderMenu } from "./menuRenderer.js";

/**
 * MAIN ENTRY POINT FOR META WEBHOOK
 * This is what meta_webhook.js is calling
 */
export async function handleIncomingMessage({ from, text, raw }) {
  // For now: ALWAYS show main menu
  // We will add routing later
  const biz = raw?.biz || null;   // safe placeholder
  const role = "owner";           // default for now

  return sendMainMenu({ to: from, biz, role });
}

/**
 * Sends role-based main menu
 */
export async function sendMainMenu({ to, biz, role }) {
  const baseMenu =
    role === "owner"
      ? MENUS.OWNER_MAIN
      : role === "manager"
      ? MENUS.MANAGER_MAIN
      : MENUS.CLERK_MAIN;

  return renderMenu({ to, menu: baseMenu });
}
