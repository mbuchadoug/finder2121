import { PACKAGES } from "./packages.js";

export function canUseFeature(biz, feature) {
  const pkg = PACKAGES[biz.package] || PACKAGES.trial;
  return pkg.features.includes(feature);
}

export function requiredPackageForFeature(feature) {
  for (const [pkg, cfg] of Object.entries(PACKAGES)) {
    if (cfg.features.includes(feature)) {
      return pkg;
    }
  }
  return null;
}

export function hasRole(userRole, allowedRoles) {
  return allowedRoles.includes(userRole);
}
