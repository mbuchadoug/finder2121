import mongoose from "mongoose";

const TutorSchema = new mongoose.Schema(
  {
    name: String,
    phone: String,
    subjects: [String],
    levels: [String],
    mode: { type: String }, // in-person | online | both
    city: String,
    experience: String,
    verified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Tutor ||
  mongoose.model("Tutor", TutorSchema);
