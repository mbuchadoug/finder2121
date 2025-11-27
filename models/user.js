import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    providerId: { type: String, required: true, index: true },
    name: String,
    email: { type: String, index: true },
    photo: String,

    role: { type: String, enum: ["user", "admin"], default: "user", index: true },

    favourites: [{ type: mongoose.Schema.Types.ObjectId, ref: "School" }],

    lastPrefs: {
      city: String,
      learningEnvironment: String, // "Comprehensive" | "Enhanced" | "Advanced"
      curriculum: [String],        // ["Cambridge","ZIMSEC","IB"]
      type: [String],              // ["High School","Primary School","Pre-School"]
      type2: [String],             // ["Day","Boarding"]
      facilities: [String],        // keys in School.facilities
    },
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);
