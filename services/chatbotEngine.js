// services/chatbotEngine.js

import { MENUS } from "./menuSchema.js";
import { filterMenu } from "./menuFilter.js";
import { renderMenu } from "./menuRenderer.js";

/**
 * Send main menu based on role
 * IMPORTANT:
 * - We are NOT auto-hiding locked features yet
 * - filterMenu will only remove items if YOU tell it to
 */
export async function sendMainMenu({ to, biz, role }) {
  let baseMenu;

  switch (role) {
    case "owner":
      baseMenu = MENUS.OWNER_MAIN;
      break;
    case "manager":
      baseMenu = MENUS.MANAGER_MAIN;
      break;
    case "clerk":
      baseMenu = MENUS.CLERK_MAIN;
      break;
    default:
      baseMenu = MENUS.OWNER_MAIN;
  }

  /**
   * 🔓 DO NOT hide locked features yet
   * This ensures Upgrade, Special Audit, etc. ALWAYS show
   */
  const menu = filterMenu(baseMenu, biz, role, {
    hideLocked: false
  });

  return renderMenu({
    to,
    menu
  });
}
