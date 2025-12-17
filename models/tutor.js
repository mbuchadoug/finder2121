// models/tutor.js
import mongoose from "mongoose";

const TutorSchema = new mongoose.Schema(
  {
    name: String,
    phone: String,
    subjects: [String],
    levels: [String],
    mode: { type: String }, // in-person | online | both
    city: String,
     bio: { type: String, default: "" }, // ✅ NEW
    experience: String,
    verified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Tutor =
  mongoose.models.Tutor || mongoose.model("Tutor", TutorSchema);

export default Tutor;
