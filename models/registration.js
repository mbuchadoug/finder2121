// models/registration.js
import mongoose from "mongoose";

const RegistrationSchema = new mongoose.Schema(
  {
    schoolSlug: { type: String, index: true },
    schoolName: String,

    // Student
    studentFirstName: String,
    studentMiddleName: String,
    studentLastName: String,
    dateOfBirth: Date,
    gender: { type: String, enum: ["Boy", "Girl", "Other"], default: "Other" },
    currentGrade: String,
    recommendedStage: String,
    previousSchools: [
      {
        name: String,
        syllabus: String,
        stageGrade: String,
        term: String,
        year: String,
      },
    ],
    languagesSpoken: String,
    allergies: String,
    siblings: [
      {
        fullName: String,
        age: String,
      },
    ],

    // Parents / guardian
    fatherName: String,
    fatherQualifications: String,
    fatherOccupation: String,
    fatherMobile: String,
    fatherEmail: String,

    motherName: String,
    motherQualifications: String,
    motherOccupation: String,
    motherMobile: String,
    motherEmail: String,

    homeAddress: String,
    workAddress: String,

    // Indemnity/agreement (simple text/signature field)
    indemnityAccepted: { type: Boolean, default: false },
    indemnityText: String,

    // meta
    submittedAt: { type: Date, default: Date.now },
    ip: String,
    userAgent: String,
  },
  { timestamps: true }
);

export default mongoose.models.Registration ||
  mongoose.model("Registration", RegistrationSchema);
