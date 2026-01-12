export const ROLE_MATRIX = {
  owner: {
    allow: ["*"]
  },

  admin: {
    allow: [
      "sales",
      "clients",
      "payments",
      "reports",
      "branches",
      "users",
      "settings"
    ]
  },

  manager: {
    allow: [
      "sales",
      "clients",
      "payments",
      "reports"
    ]
  },

  clerk: {
    allow: [
      "sales",
      "clients"
    ]
  }
};
