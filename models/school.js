import mongoose from "mongoose";

const FacilitiesSchema = new mongoose.Schema(
  {
    // Academics
    scienceLabs: { type: Boolean, default: false },
    computerLab: { type: Boolean, default: false },
    library: { type: Boolean, default: false },
    makerSpaceSteamLab: { type: Boolean, default: false },
    examCentreCambridge: { type: Boolean, default: false },
    examCentreZimsec: { type: Boolean, default: false },

    // Arts & Culture
    artStudio: { type: Boolean, default: false },
    musicRoom: { type: Boolean, default: false },
    dramaTheatre: { type: Boolean, default: false },

    // Sports
    swimmingPool: { type: Boolean, default: false },
    athleticsTrack: { type: Boolean, default: false },
    rugbyField: { type: Boolean, default: false },
    hockeyField: { type: Boolean, default: false },
    tennisCourts: { type: Boolean, default: false },
    basketballCourt: { type: Boolean, default: false },
    netballCourt: { type: Boolean, default: false },
    footballPitch: { type: Boolean, default: false },
    cricketField: { type: Boolean, default: false },

    // Student Support & Welfare
    counseling: { type: Boolean, default: false },
    learningSupportSEN: { type: Boolean, default: false },
    schoolClinicNurse: { type: Boolean, default: false },
    cafeteria: { type: Boolean, default: false },
    aftercare: { type: Boolean, default: false },

    // Boarding & Logistics
    boarding: { type: Boolean, default: false },
    transportBuses: { type: Boolean, default: false },

    // Campus & Safety
    wifiCampus: { type: Boolean, default: false },
    cctvSecurity: { type: Boolean, default: false },
    powerBackup: { type: Boolean, default: false },
  },
  { _id: false }
);

const SchoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    city: { type: String, index: true, default: "Harare" },

    type: { type: [String], default: [] },   // ["High School","Primary School","Pre-School"]
    type2: { type: [String], default: [] },  // ["Day","Boarding"]

    gender: { type: String },
    curriculum_list: { type: [String], default: [] },

    address: { type: String },
    contact: { type: String },

    // Hidden fee proxy
    tier: { type: String, enum: ["premium", "upper-middle", "lower-middle"], index: true },

    // Public neutral label (optional)
    learningEnvironment: {
      type: String,
      enum: ["Advanced", "Enhanced", "Comprehensive"],
    },

    facilities: { type: FacilitiesSchema, default: {} },

    hasWebsite: { type: Boolean, default: false, index: true },
    hasFacebook: { type: Boolean, default: false, index: true },
    website: String,
    facebookUrl: String,

    normalizedName: { type: String, index: true },
    source: String,
    lastVerifiedAt: Date,
  },
  { timestamps: true }
);

SchoolSchema.index({ city: 1, normalizedName: 1 }, { unique: true });
SchoolSchema.index({ curriculum_list: 1 });
SchoolSchema.index({ "facilities.boarding": 1 });

export default mongoose.models.School || mongoose.model("School", SchoolSchema);
