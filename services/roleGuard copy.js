// services/roleGuard.js
import UserRole from "../models/userRole.js";

/**
 * Check if WhatsApp user has required role
 */
export async function requireRole(biz, phone, allowedRoles = []) {
  const role = await UserRole.findOne({
    businessId: biz._id,
    phone,
    pending: false
  }).lean();

  if (!role) return false;
  return allowedRoles.includes(role.role);
}
