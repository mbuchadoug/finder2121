import { sendText, sendButtons, sendList } from "./metaSender.js";

export async function renderMenu({ channel, to, menu }) {
  if (channel === "meta") {
    // Buttons (max 3)
    if (menu.items.length <= 3) {
      return sendButtons(to, {
        text: menu.title,
        buttons: menu.items
      });
    }

    // List (more than 3)
    return sendList(to, {
      title: menu.title,
      button: "Choose",
      items: menu.items
    });
  }

  // Twilio fallback (TEXT)
  let msg = `${menu.title}\n`;
  menu.items.forEach((i, idx) => {
    msg += `${idx + 1}) ${i.label}\n`;
  });
  msg += `0) Menu`;

  return sendText(to, msg);
}
