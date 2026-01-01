import mongoose from "mongoose";

const InvoiceSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, index: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },

  number: { type: String, index: true },
  currency: String,

  status: {
  type: String,
  enum: ["unpaid", "partial", "paid"],
  default: "unpaid"
},

amountPaid: {
  type: Number,
  default: 0
},

balance: {
  type: Number,
  default: 0
}
,

  items: [{
    item: String,
    qty: Number,
    unit: Number,
    total: Number
  }],

  subtotal: Number,
  discountPercent: Number,
  discountAmount: Number,
  vatPercent: Number,
  vatAmount: Number,
  total: Number,

  status: { type: String, default: "sent" }, // sent | partial | paid
  createdBy: String
}, { timestamps: true });

export default mongoose.model("Invoice", InvoiceSchema);
