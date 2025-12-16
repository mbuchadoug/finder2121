// models/user.js
import mongoose from "mongoose";

const LastPrefsSchema = new mongoose.Schema(
  {
    city: String,
    curriculum: [String],
    type2: [String],
    facilities: [String],
    schoolPhase: [String], // ARRAY (fixes cast error)
    learningEnvironment: String,
    gender: String,
  },
  { _id: false }
);

const TutorProfileSchema = new mongoose.Schema(
  {
    subject: String,
    level: String,
    city: String,
    phone: String,
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    provider: String,
    providerId: { type: String, index: true },
    name: String,

    role: { type: String, default: "user" },

    favourites: [{ type: mongoose.Schema.Types.ObjectId, ref: "School" }],

    lastPrefs: { type: LastPrefsSchema, default: {} },

    chatState: { type: String, default: "WELCOME" },

    tutorProfile: { type: TutorProfileSchema, default: {} },
  },
  { timestamps: true }
);

// ✅ DEFAULT EXPORT (THIS FIXES THE CRASH)
export default mongoose.models.User ||
  mongoose.model("User", UserSchema);
