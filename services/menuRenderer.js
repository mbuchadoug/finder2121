import { sendText, sendList } from "./metaSender.js";

export async function renderMenu({ to, menu }) {
  if (!menu || !menu.title || !Array.isArray(menu.items)) {
    console.error("❌ Invalid menu structure:", menu);
    return sendText(to, "Menu unavailable. Please try again.");
  }

  return sendList({
    to,
    header: menu.title,
    items: menu.items
  });
}
