import { Router } from "express";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import methodOverride from "method-override";
import School from "../models/school.js";
import User from "../models/user.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// enable method override (reads req.body._method)
router.use(methodOverride("_method"));

function ensureAuthed(req, res, next) {
  if (!req.user) return res.redirect("/auth/google");
  next();
}
function ensureAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).send("Forbidden");
  next();
}

// ----- Dashboard
router.get("/", ensureAuthed, ensureAdmin, async (_req, res) => {
  const [schoolCount, userCount] = await Promise.all([
    School.countDocuments({}),
    User.countDocuments({}),
  ]);
  res.render("admin/dashboard", { title: "Admin · Dashboard", schoolCount, userCount });
});

// ----- Users list
router.get("/users", ensureAuthed, ensureAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  const filter = q
    ? { $or: [{ email: new RegExp(q, "i") }, { name: new RegExp(q, "i") }] }
    : {};
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  res.render("admin/users_list", { title: "Admin · Users", users, q });
});

// ----- Delete user (DELETE)
// ---- DELETE user (supports method-override DELETE)
router.delete("/users/:id", ensureAuthed, ensureAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    // Prevent deleting yourself (optional)
    if (req.user && String(req.user._id) === String(id)) {
      return res.status(400).send("Cannot delete yourself");
    }

    await User.findByIdAndDelete(id);
    // If request is AJAX, return JSON
    if (req.xhr || req.headers.accept?.includes("application/json")) {
      return res.json({ ok: true });
    }
    // otherwise redirect back to users list
    res.redirect("/admin/users");
  } catch (err) {
    console.error("[admin/users/delete] error:", err);
    res.status(500).send("Failed to delete user");
  }
});

// ---- Fallback POST route (handy for forms without proper _method)
router.post("/users/:id/delete", ensureAuthed, ensureAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (req.user && String(req.user._id) === String(id)) {
      return res.status(400).send("Cannot delete yourself");
    }
    await User.findByIdAndDelete(id);
    if (req.xhr || req.headers.accept?.includes("application/json")) {
      return res.json({ ok: true });
    }
    res.redirect("/admin/users");
  } catch (err) {
    console.error("[admin/users/post-delete] error:", err);
    res.status(500).send("Failed to delete user");
  }
});

/* ---------- rest of your admin routes (schools, import, etc) ---------- */
/* I'm keeping the rest of your file unchanged; append the previous school routes here */
/* If you replaced the file entirely, paste your other routes (schools, import, etc) below */

export default router;
