import mongoose from "mongoose";

const BusinessSchema = new mongoose.Schema({
  provider: { type: String, default: "whatsapp" },
  providerId: { type: String, index: true }, // whatsapp phone
  name: String,
  email: String,
  address: String,
  currency: { type: String, default: "ZWL" },
  paymentTermsDays: { type: Number, default: 30 },
  logoUrl: String, // public URL
  invoicePrefix: { type: String, default: "INV" },
  quotePrefix: { type: String, default: "QT" },
  counters: { invoice: { type: Number, default: 0 }, quote: { type: Number, default: 0 }, receipt: { type: Number, default: 0 } },
  sessionState: { type: String, default: null },


  package: {
  type: String,
  enum: ["bronze", "silver", "gold", "enterprise"],
  default: "bronze"
},
subscriptionStatus: {
  type: String,
  enum: ["active", "expired", "trial"],
  default: "trial"
},
documentCountMonth: { type: Number, default: 0 },
documentCountMonthKey: { type: String }, // YYYY-MM

  sessionData: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

export default mongoose.models.Business || mongoose.model("Business", BusinessSchema);
