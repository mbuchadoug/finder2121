// services/menuRenderer.js
import { sendText } from "./metaSender.js";

export async function renderMenu({ to, menu }) {
  let text = menu.title + "\n\n";

  menu.items.forEach(item => {
    text += `${item.key}) ${item.label}\n`;
  });

  if (menu.footer) {
    text += `\n${menu.footer}`;
  }

  return sendText(to, text);
}
