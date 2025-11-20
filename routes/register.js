// routes/register.js
import { Router } from "express";
import { body, validationResult } from "express-validator";
import Registration from "../models/registration.js";
import School from "../models/school.js";
import nodemailer from "nodemailer";

const router = Router();

// helper: simple transporter that logs if no SMTP configured
function makeTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // fallback: transport that logs to console (useful for dev)
    return {
      sendMail: async (opts) => {
        console.log("=== email fallback (SMTP not configured) ===");
        console.log("to:", opts.to);
        console.log("subject:", opts.subject);
        console.log("text:", opts.text);
        return true;
      },
    };
  }
}

/* GET /register/:slug — show form prefilling school info */
router.get("/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;
    let school = null;
    if (slug) {
      school = await School.findOne({ slug }).select("name slug city").lean();
    }
    res.render("register_form", {
      title: "Student Registration",
      school,
      // include contact email to display to users
      schoolContactEmail: process.env.SCHOOL_CONTACT_EMAIL || "enquiries@steuritintenationalschool.org",
    });
  } catch (err) {
    console.error("[register:get] error:", err);
    res.status(500).send("Failed to load registration form");
  }
});

/* POST /register — submit form */
router.post(
  "/",
  [
    // server-side light validation
    body("studentFirstName").trim().notEmpty().withMessage("Student first name is required"),
    body("studentLastName").trim().notEmpty().withMessage("Student last name is required"),
    body("fatherMobile").trim().notEmpty().withMessage("Parent contact required"),
    // more validators can be added as needed
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        // re-render with errors (simple)
        return res.status(400).render("register_form", {
          title: "Student Registration - Errors",
          errors: errors.array(),
          form: req.body,
        });
      }

      const reg = await Registration.create({
        schoolSlug: req.body.schoolSlug,
        schoolName: req.body.schoolName,
        studentFirstName: req.body.studentFirstName,
        studentMiddleName: req.body.studentMiddleName,
        studentLastName: req.body.studentLastName,
        dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : undefined,
        gender: req.body.gender,
        currentGrade: req.body.currentGrade,
        recommendedStage: req.body.recommendedStage,
        previousSchools: Array.isArray(req.body.previousSchools)
          ? req.body.previousSchools
          : req.body.previousSchools
          ? [req.body.previousSchools]
          : [],
        languagesSpoken: req.body.languagesSpoken,
        allergies: req.body.allergies,
        siblings: req.body.siblings || [],
        fatherName: req.body.fatherName,
        fatherQualifications: req.body.fatherQualifications,
        fatherOccupation: req.body.fatherOccupation,
        fatherMobile: req.body.fatherMobile,
        fatherEmail: req.body.fatherEmail,
        motherName: req.body.motherName,
        motherQualifications: req.body.motherQualifications,
        motherOccupation: req.body.motherOccupation,
        motherMobile: req.body.motherMobile,
        motherEmail: req.body.motherEmail,
        homeAddress: req.body.homeAddress,
        workAddress: req.body.workAddress,
        indemnityAccepted: !!req.body.indemnityAccepted,
        indemnityText: req.body.indemnityText,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      // send email to school enquiries
      const transporter = makeTransporter();

      const toEmail = process.env.SCHOOL_CONTACT_EMAIL || "enquiries@steuritintenationalschool.org";
      const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || "no-reply@example.com";

      const subject = `New registration: ${reg.studentFirstName} ${reg.studentLastName} — ${reg.schoolName || reg.schoolSlug || ""}`;
      const lines = [
        `School: ${reg.schoolName || reg.schoolSlug || "n/a"}`,
        `Student: ${reg.studentFirstName} ${reg.studentMiddleName || ""} ${reg.studentLastName}`,
        `DOB: ${reg.dateOfBirth ? reg.dateOfBirth.toISOString().split("T")[0] : "n/a"}`,
        `Gender: ${reg.gender || ""}`,
        `Current grade: ${reg.currentGrade || ""}`,
        `Father mobile: ${reg.fatherMobile || ""}`,
        `Father email: ${reg.fatherEmail || ""}`,
        `Mother mobile: ${reg.motherMobile || ""}`,
        `Mother email: ${reg.motherEmail || ""}`,
        "",
        "Full submission JSON follows:",
        JSON.stringify(reg.toObject ? reg.toObject() : reg, null, 2),
      ];
      const text = lines.join("\n");

      await transporter.sendMail({
        from: fromEmail,
        to: toEmail,
        subject,
        text,
      });

      res.render("register_success", {
        title: "Registration submitted",
        emailTo: toEmail,
      });
    } catch (err) {
      console.error("[register:post] error:", err);
      res.status(500).send("Failed to submit registration");
    }
  }
);

export default router;
