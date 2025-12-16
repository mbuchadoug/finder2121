const LastPrefsSchema = new mongoose.Schema(
  {
    city: String,

    curriculum: [{ type: String }],
    type2: [{ type: String }],
    facilities: [{ type: String }],

    schoolPhase: [{ type: String }],   // ✅ FIXED (array)
    learningEnvironment: String,
    gender: String,
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema({
  provider: String,
  providerId: String,
  name: String,

  role: { type: String, default: "user" },

  favourites: [{ type: mongoose.Schema.Types.ObjectId, ref: "School" }],

  lastPrefs: { type: LastPrefsSchema, default: {} },

  // ✅ NEW: chatbot state
  chatState: {
    type: String,
    default: "WELCOME", // WELCOME | SCHOOL_MENU | SCHOOL_QUICK | TUTOR_MENU | TUTOR_REGISTER
  }
});
