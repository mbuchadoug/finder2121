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

// ----- Schools: list
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
  const body = normalizeSchoolPayload(req.body);
  await School.create(body);
  res.redirect("/admin/schools");
});

// Edit form
router.get("/schools/:id/edit", ensureAuthed, ensureAdmin, async (req, res) => {
  const school = await School.findById(req.params.id).lean();
  if (!school) return res.status(404).send("Not found");
  res.render("admin/school_form", {
    title: `Admin · Edit ${school.name}`,
    school,
    isNew: false,
  });
});

// UPDATE
router.put("/schools/:id", ensureAuthed, ensureAdmin, async (req, res) => {
  const body = normalizeSchoolPayload(req.body);
  await School.findByIdAndUpdate(req.params.id, { $set: body });
  res.redirect("/admin/schools");
});

// DELETE
router.delete("/schools/:id", ensureAuthed, ensureAdmin, async (req, res) => {
  await School.findByIdAndDelete(req.params.id);
  res.redirect("/admin/schools");
});

// ----- Import page
router.get("/import", ensureAuthed, ensureAdmin, (_req, res) => {
  res.render("admin/import", { title: "Admin · Import Schools" });
});

// Import handler (JSON array or CSV)
router.post("/import", ensureAuthed, ensureAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");
  const filename = (req.file.originalname || "").toLowerCase();

  try {
    let items = [];
    if (filename.endsWith(".json")) {
      items = JSON.parse(req.file.buffer.toString("utf-8"));
      if (!Array.isArray(items)) throw new Error("JSON must be an array of schools");
    } else if (filename.endsWith(".csv")) {
      items = csvParse(req.file.buffer.toString("utf-8"), {
        columns: true,
        skip_empty_lines: true,
      });
    } else {
      throw new Error("Unsupported file type. Use .json or .csv");
    }

    let upserted = 0;
    for (const item of items) {
      const doc = normalizeSchoolPayload(item);

      // recompute normalizedName from name; never trust incoming column
      const normalizedName = String(doc.name || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      if (!normalizedName) continue;

      const city = doc.city || "Harare";

      // IMPORTANT: never include normalizedName in $set to avoid conflict
      const { normalizedName: _ignore, ...setDoc } = doc;

      await School.updateOne(
        { city, normalizedName },
        {
          $set: setDoc,
          $setOnInsert: { source: "admin-import", normalizedName },
        },
        { upsert: true }
      );
      upserted++;
    }

    res.render("admin/import", {
      title: "Admin · Import Schools",
      msg: `Import complete: ${upserted} records processed.`,
    });
  } catch (e) {
    res
      .status(400)
      .render("admin/import", { title: "Admin · Import Schools", error: e.message });
  }
});

// ----- Users list
/*router.get("/users", ensureAuthed, ensureAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  const filter = q
    ? { $or: [{ email: new RegExp(q, "i") }, { name: new RegExp(q, "i") }] }
    : {};
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  res.render("admin/users_list", { title: "Admin · Users", users, q });
});
*/

// ----- Users list
router.get("/users", ensureAuthed, ensureAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  const filter = q
    ? { $or: [{ email: new RegExp(q, "i") }, { name: new RegExp(q, "i") }] }
    : {};
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  const msg = req.query.msg || null;
  res.render("admin/users_list", { title: "Admin · Users", users, q, msg });
});

// DELETE user
router.delete("/users/:id", ensureAuthed, ensureAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    // Prevent deleting the currently logged-in admin user
    if (req.user && String(req.user._id) === String(id)) {
      return res.status(400).redirect("/admin/users?q=&msg=" + encodeURIComponent("You cannot delete your own account."));
    }

    const u = await User.findById(id);
    if (!u) {
      return res.status(404).redirect("/admin/users?q=&msg=" + encodeURIComponent("User not found."));
    }

    await User.findByIdAndDelete(id);
    return res.redirect("/admin/users?q=&msg=" + encodeURIComponent("User deleted."));
  } catch (err) {
    console.error("Error deleting user:", err);
    return res.status(500).redirect("/admin/users?q=&msg=" + encodeURIComponent("Failed to delete user."));
  }
});

// ----------------- helpers -----------------
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function toBool(v) {
  const t = String(v ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "on"].includes(t);
}

// Case-insensitive getter for possible header names
function getCI(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") return obj[k];
  }
  return undefined;
}
// Split string/array into clean array (commas, pipes, semicolons, slashes)
function splitToArray(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(/[,\|;/]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// Canon maps
const CANON_PHASES = new Map([
  ["pre-school", "Pre-School"],
  ["preschool", "Pre-School"],
  ["early years", "Pre-School"],
  ["primary", "Primary School"],
  ["primary school", "Primary School"],
  ["junior", "Primary School"],
  ["high", "High School"],
  ["high school", "High School"],
  ["secondary", "High School"],
]);
const CANON_TYPE2 = new Map([
  ["day", "Day"],
  ["boarding", "Boarding"],
  ["day & boarding", "Day"],      // leave boarding tracked via facilities
  ["day and boarding", "Day"],
]);
const CANON_CURR = new Map([
  ["cambridge", "Cambridge"],
  ["zimsec", "ZIMSEC"],
  ["ib", "IB"],
  ["international baccalaureate", "IB"],
]);
const canon = (map, s) => map.get(String(s).toLowerCase().trim()) || s;

function normalizeSchoolPayload(body) {
  const name = String(getCI(body, ["name", "Name"]) || "").trim();
  const city = String(getCI(body, ["city", "City"]) || "Harare").trim();
  const slugFromUpload = getCI(body, ["slug", "Slug"]);
  const slug = (slugFromUpload && String(slugFromUpload).trim()) || `${slugify(name)}-${slugify(city)}`;

  // Accept multiple header variants for array fields
  const typeRaw   = getCI(body, ["type", "Type", "TYPE", "schoolPhase", "phase"]);
  const type2Raw  = getCI(body, ["type2", "Type2", "TYPE2", "day_boarding", "boardingDay"]);
  const currRaw   = getCI(body, ["curriculum_list", "curriculum", "Curriculum", "Curriculum_list"]);

  // Canonicalize arrays
  const typeArr   = splitToArray(typeRaw).map((x) => canon(CANON_PHASES, x));
  const type2Arr  = splitToArray(type2Raw).map((x) => canon(CANON_TYPE2, x));
  const currArr   = splitToArray(currRaw).map((x) => canon(CANON_CURR, x));

  // facilities from checkboxes or CSV columns
  const facilitiesKeys = [
    "scienceLabs","computerLab","library","makerSpaceSteamLab",
    "examCentreCambridge","examCentreZimsec",
    "artStudio","musicRoom","dramaTheatre",
    "swimmingPool","athleticsTrack","rugbyField","hockeyField",
    "tennisCourts","basketballCourt","netballCourt","footballPitch","cricketField",
    "counseling","learningSupportSEN","schoolClinicNurse","cafeteria","aftercare",
    "boarding","transportBuses","wifiCampus","cctvSecurity","powerBackup",
  ];
  const facilities = {};
  for (const k of facilitiesKeys) {
    if (k in body) facilities[k] = toBool(body[k]);
  }
  // If Type2 implies boarding, reflect in facilities
  if (type2Arr.some((t) => /boarding/i.test(t))) facilities.boarding = true;

  const doc = {
    name,
    slug,
    city,
    type: typeArr,
    type2: type2Arr,
    gender: getCI(body, ["gender", "Gender"]) || undefined,
    curriculum_list: currArr,
    address: getCI(body, ["address", "Address"]) || undefined,
    contact: getCI(body, ["contact", "Contact"]) || undefined,
    website: getCI(body, ["website", "Website"]) || undefined,
    facebookUrl: getCI(body, ["facebookUrl", "Facebook", "facebook", "FacebookUrl"]) || undefined,
    tier: getCI(body, ["tier", "Tier"]) || undefined,
    learningEnvironment: getCI(body, ["learningEnvironment", "LearningEnvironment"]) || undefined,
    facilities,
    lastVerifiedAt: new Date(),
  };

  // Clean empties
  if (!doc.type?.length) delete doc.type;
  if (!doc.type2?.length) delete doc.type2;
  if (!doc.curriculum_list?.length) delete doc.curriculum_list;
  if (Object.keys(facilities).length === 0) delete doc.facilities;

  return doc;
}

export default router;
