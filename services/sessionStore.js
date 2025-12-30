const sessions = new Map();

export function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {});
  }
  return sessions.get(phone);
}

export function setSession(phone, data) {
  sessions.set(phone, data);
}

export function clearSession(phone) {
  sessions.delete(phone);
}
