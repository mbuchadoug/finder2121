import { Router } from "express";
import Tutor from "../models/tutor.js";

const router = Router();

/* ===============================
   LIST TUTORS (HBS VIEW)
================================ */

router.get("/admin/tutors", async (req, res) => {
  try {
    const tutors = await Tutor.find().sort({ createdAt: -1 }).lean();

    res.render("admin/tutors", {
      title: "Manage Tutors",
      tutors,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to load tutors");
  }
});

/* ===============================
   VERIFY TUTOR
================================ */

router.post("/admin/tutors/:id/verify", async (req, res) => {
  try {
    await Tutor.findByIdAndUpdate(req.params.id, { verified: true });
    res.redirect("/admin/tutors");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to verify tutor");
  }
});

/* ===============================
   UNVERIFY TUTOR
================================ */

router.post("/admin/tutors/:id/unverify", async (req, res) => {
  try {
    await Tutor.findByIdAndUpdate(req.params.id, { verified: false });
    res.redirect("/admin/tutors");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to unverify tutor");
  }
});

/* ===============================
   DELETE TUTOR
================================ */

router.post("/admin/tutors/:id/delete", async (req, res) => {
  try {
    await Tutor.findByIdAndDelete(req.params.id);
    res.redirect("/admin/tutors");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to delete tutor");
  }
});

export default router;
