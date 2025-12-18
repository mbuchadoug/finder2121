import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, index: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },

  amount: Number,
  method: String, // cash | ecocash | bank
  reference: String,
  receivedBy: String
}, { timestamps: true });

export default mongoose.model("Payment", PaymentSchema);
