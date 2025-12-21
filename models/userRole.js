import mongoose from "mongoose";

const UserRoleSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, index: true },
  phone: { type: String, index: true },
  pending: { type: Boolean, default: true },
  role: {
    type: String,
    enum: ["owner", "admin", "manager", "clerk"],
    default: "owner"
  }
}, { timestamps: true });

export default mongoose.model("UserRole", UserRoleSchema);
