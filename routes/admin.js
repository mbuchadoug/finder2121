// routes/admin.js
import { Router } from "express";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import methodOverride from "method-override";
import School from "../models/school.js";
import User from "../models/userCopy.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// small module-load log to confirm file is loaded on startup
console.log("🔥 admin routes module loaded");

// enable method override (reads req.body._method)
router.use(methodOverride("_method"));

/* ----------------- helpers: normalize payload ----------------- */
/**
 * Normalize incoming form/body data into a School-compatible object.
 * Handles comma/array inputs, checkbox "on"/"true"/"1" values, and populates
 * facilities keys expected by the model.
 */
function toArray(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === undefined || v === null || v === "") return false;
  const s = String(v).toLowerCase();
  return ["true", "on", "1", "yes"].includes(s);
}

const FACILITY_KEYS = [
  // keep keys in sync with models/school.js FacilitiesSchema
  "scienceLabs",
  "computerLab",
  "library",
  "makerSpaceSteamLab",
  "examCentreCambridge",
  "examCentreZimsec",
  "artStudio",
  "musicRoom",
  "dramaTheatre",
  "swimmingPool",
  "athleticsTrack",
  "rugbyField",
  "hockeyField",
  "tennisCourts",
  "basketballCourt",
  "netballCourt",
  "footballPitch",
  "cricketField",
  "counseling",
  "learningSupportSEN",
  "schoolClinicNurse",
  "cafeteria",
  "aftercare",
  "boarding",
  "transportBuses",
  "wifiCampus",
  "cctvSecurity",
  "powerBackup",
];

function normalizeSchoolPayload(body = {}) {
  const curriculum_list = toArray(body.curriculum_list || body.curriculum || body.curricula);
  const type = toArray(body.type);
  const type2 = toArray(body.type2);

  // Build facilities object
  const facilities = {};
  for (const k of FACILITY_KEYS) {
    facilities[k] = parseBool(body[k]);
  }

  const name = body.name ? String(body.name).trim() : "";
  const slug = body.slug ? String(body.slug).trim() : "";
  const normalizedName = name ? name.toLowerCase().replace(/\s+/g, " ").trim() : "";

  const result = {
    name,
    slug,
    normalizedName,
    city: body.city ? String(body.city).trim() : "Harare",
    type,
    type2,
    curriculum_list,
    address: body.address ? String(body.address).trim() : undefined,
    contact: body.contact ? String(body.contact).trim() : undefined,
    tier: body.tier || undefined,
    learningEnvironment: body.learningEnvironment || undefined,
    facilities,
    website: body.website ? String(body.website).trim() : undefined,
    facebookUrl: body.facebookUrl ? String(body.facebookUrl).trim() : undefined,
    hasWebsite: !!(body.website && String(body.website).trim()),
    hasFacebook: !!(body.facebookUrl && String(body.facebookUrl).trim()),
    source: body.source ? String(body.source).trim() : undefined,
  };

  // Remove undefined fields so mongoose won't overwrite with undefined
  Object.keys(result).forEach((k) => {
    if (result[k] === undefined) delete result[k];
  });

  return result;
}

/* ----------------- auth helpers ----------------- */
function ensureAuthed(req, res, next) {
  if (!req.user) return res.redirect("/auth/google");
  next();
}
function ensureAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).send("Forbidden");
  next();
}

/* ----------------- admin routes ----------------- */

// Dashboard
router.get("/", ensureAuthed, ensureAdmin, async (_req, res) => {
  const [schoolCount, userCount] = await Promise.all([
    School.countDocuments({}),
    User.countDocuments({}),
  ]);
  res.render("admin/dashboard", { title: "Admin · Dashboard", schoolCount, userCount });
});

// Users list
router.get("/users", ensureAuthed, ensureAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  const filter = q
    ? { $or: [{ email: new RegExp(q, "i") }, { name: new RegExp(q, "i") }] }
    : {};
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  res.render("admin/users_list", { title: "Admin · Users", users, q });
});

// Delete user (DELETE)
router.delete("/users/:id", ensureAuthed, ensureAdmin, async (req, res) => {
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
    console.error("[admin/users/delete] error:", err);
    res.status(500).send("Failed to delete user");
  }
});

// Fallback POST route (handy for forms without proper _method)
router.post("/users/:id/delete", ensureAuthed, ensureAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (req.user && String(req.user._1d) === String(id)) {
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

/* ---------- schools CRUD ---------- */

router.get("/schools", ensureAuthed, ensureAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  const filter = q ? { name: new RegExp(q, "i") } : {};
  const schools = await School.find(filter).sort({ name: 1 }).limit(500).lean();
  res.render("admin/schools_list", { title: "Admin · Schools", schools, q });
});

// Create form
router.get("/schools/new", ensureAuthed, ensureAdmin, (_req, res) => {
  res.render("admin/school_form", { title: "Admin · New School", school: {}, isNew: true });
});

// Create submit
router.post("/schools", ensureAuthed, ensureAdmin, async (req, res) => {
  try {
    const body = normalizeSchoolPayload(req.body);
    await School.create(body);
    res.redirect("/admin/schools");
  } catch (err) {
    console.error("[admin/schools/create] error:", err);
    // If validation error, re-render form with error info (simple handling)
    if (err && err.name === "ValidationError") {
      return res.status(400).render("admin/school_form", {
        title: "Admin · New School",
        school: req.body,
        errors: err.errors,
        isNew: true,
      });
    }
    res.status(500).send("Failed to create school");
  }
});

// Edit form
router.get("/schools/:id/edit", ensureAuthed, ensureAdmin, async (req, res) => {
  try {
    const school = await School.findById(req.params.id).lean();
    if (!school) return res.status(404).send("Not found");
    res.render("admin/school_form", {
      title: `Admin · Edit ${school.name}`,
      school,
      isNew: false,
    });
  } catch (err) {
    console.error("[admin/schools/edit] error:", err);
    res.status(500).send("Failed to load school");
  }
});

// UPDATE
router.put("/schools/:id", ensureAuthed, ensureAdmin, async (req, res) => {
  try {
    const body = normalizeSchoolPayload(req.body);
    await School.findByIdAndUpdate(req.params.id, { $set: body });
    res.redirect("/admin/schools");
  } catch (err) {
    console.error("[admin/schools/update] error:", err);
    if (err && err.name === "ValidationError") {
      return res.status(400).render("admin/school_form", {
        title: `Admin · Edit`,
        school: Object.assign({}, req.body, { _id: req.params.id }),
        errors: err.errors,
        isNew: false,
      });
    }
    res.status(500).send("Failed to update school");
  }
});

// DELETE
router.delete("/schools/:id", ensureAuthed, ensureAdmin, async (req, res) => {
  try {
    await School.findByIdAndDelete(req.params.id);
    res.redirect("/admin/schools");
  } catch (err) {
    console.error("[admin/schools/delete] error:", err);
    res.status(500).send("Failed to delete school");
  }
});

/* ---------- optional CSV import / other admin endpoints (placeholder) ---------- */
/* Add your CSV import, bulk actions, etc. here. */

/* ---------- small debug/test routes (remove in prod) ---------- */

// quick test that normalize works (POST JSON/form→returns normalized payload)
router.post("/_debug_norm", ensureAuthed, ensureAdmin, (req, res) => {
  res.json({ normalized: normalizeSchoolPayload(req.body) });
});

// small route to confirm /admin base mounting (GET /admin/test)
router.get("/test", ensureAuthed, ensureAdmin, (_req, res) => {
  res.send("admin base works");
});

export default router;
