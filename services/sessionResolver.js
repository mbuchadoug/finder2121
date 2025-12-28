// services/sessionResolver.js

/**
 * Normalizes user input from Meta UI (buttons, lists) or text
 * Returns a single string you can feed into your existing state machine
 */
export function resolveUserState({ text, interactive }) {
  // Button reply
  if (interactive?.button_reply?.id) {
    return interactive.button_reply.id;
  }

  // List reply
  if (interactive?.list_reply?.id) {
    return interactive.list_reply.id;
  }

  // Fallback to text
  return text?.trim() || "";
}
