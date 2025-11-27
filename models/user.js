// models/user.js (snippet)
import mongoose from "mongoose";
const { Schema } = mongoose;

const LastPrefsSchema = new Schema({
  city: { type: String },
  curriculum: [{ type: String }],
  learningEnvironment: { type: String },
  schoolPhase: { type: String },
  type2: [{ type: String }],
  facilities: [{ type: String }],
}, { _id: false });

const UserSchema = new Schema({
  provider: String,
  providerId: String,
  name: String,
  role: { type: String, default: "user" },
  favourites: [{ type: Schema.Types.ObjectId, ref: "School" }],
  // keep legacy `lastPrefs` if you depend on it elsewhere
  lastPrefs: { type: [String], default: [] }, // leave as is if you used it previously
  // new structured prefs
  lastPrefsObj: { type: LastPrefsSchema, default: {} },
  // ...
}, { timestamps: true });

export default mongoose.model("User", UserSchema);
