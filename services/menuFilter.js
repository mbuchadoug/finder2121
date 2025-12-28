// services/menuFilter.js

/**
 * Filters menu items based on business state, role, package, etc.
 * 
 * IMPORTANT:
 * - For now, we do NOT hide locked features
 * - We only return the menu unchanged
 * - Later we will add feature-lock logic here
 */
export function filterMenu(menu, biz, role, options = {}) {
  const { hideLocked = false } = options;

  // 🚨 For now, do NOTHING
  // We want ALL menu items visible
  if (!hideLocked) {
    return menu;
  }

  // 🔒 FUTURE: hide locked items here
  // Example (not active yet):
  // return menu.filter(item => canUseFeature(biz, item.featureKey))

  return menu;
}
