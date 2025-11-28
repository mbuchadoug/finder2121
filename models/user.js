// models/user.js
import mongoose from "mongoose";

const LastPrefsSchema = new mongoose.Schema(
  {
    city: { type: String },
    learningEnvironment: { type: String }, // e.g. "Urban", "Suburban", "Rural"
    curriculum: [{ type: String }],         // ["Cambridge","ZIMSEC","IB"]
    type: [{ type: String }],               // ["High School","Primary School","Pre-School"]
    type2: [{ type: String }],              // ["Day","Boarding"]
    facilities: [{ type: String }],         // keys in School.facilities
    schoolPhase: { type: String },          // e.g. "Primary", "Secondary", "Preschool"
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    providerId: { type: String, required: true, index: true },
    name: String,
    email: { type: String, index: true },
    photo: String,

    role: { type: String, enum: ["user", "admin"], default: "user", index: true },

    favourites: [{ type: mongoose.Schema.Types.ObjectId, ref: "School" }],

    // lastPrefs as a nested object (not an array) to avoid cast errors
    lastPrefs: { type: LastPrefsSchema, default: {} },
  },
  { timestamps: true }
);

// Avoid model overwrite errors in watch/reload environments
export default mongoose.models.User || mongoose.model("User", UserSchema);
