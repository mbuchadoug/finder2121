import express from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import passport from "passport";
import helmet from "helmet";
import axios from "axios";
import { engine } from "express-handlebars";
import { ensureAuth } from "./middleware/ensureAuth.js";
import MongoStore from "connect-mongo";
import session from "express-session";
import registerRoutes from "./routes/register.js";
import twilioWebhookRoutes from "./routes/twilio_webhook.js";

dotenv.config();
const PROD = process.env.NODE_ENV === "production";
const SITE_URL = process.env.SITE_URL || "https://skoolfinder.net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
if (PROD) app.set("trust proxy", 1);

// request logger
app.use((req, res, next) => {
  console.log("REQ ->", req.method, req.originalUrl, "host:", req.get("host"));
  next();
});

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load Passport strategies
import "./config/passport.js";

// Models used by sitemap/og
import School from "./models/school.js";

import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import adminRoutes from "./routes/admin.js";

app.use(express.static(path.join(__dirname, "public")));

/* ---------- Docs / downloads ---------- */
const DOCS_DIR = path.join(__dirname, "public", "docs");

// Add the 3 St-Eurit files (ensure keys match /download/:key mapping)
const DOWNLOADS = new Map([
  [
    "st-eurit-registration",
    {
      path: path.join(DOCS_DIR, "st-eurit-registration.pdf"),
      filename: "St-Eurit-Registration-Form.pdf",
    },
  ],
  [
    "st-eurit-profile",
    {
      path: path.join(DOCS_DIR, "st-eurit-profile.pdf"),
      filename: "St-Eurit-School-Profile.pdf",
    },
  ],
  [
    "st-eurit-enrollment",
    {
      path: path.join(DOCS_DIR, "st-eurit-enrollment-requirements.pdf"),
      filename: "St-Eurit-Enrollment-Requirements.pdf",
    },
  ],
]);

// serve /docs static and ensure pdf content-type
app.use(
  "/docs",
  express.static(DOCS_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath && filePath.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    },
  })
);

app.get("/download/:key", async (req, res) => {
  try {
    const entry = DOWNLOADS.get(req.params.key);
    if (!entry) return res.status(404).send("Not found");
    const { path: filePath, filename } = entry;
    await fs.promises.access(filePath, fs.constants.R_OK);
    const stat = await fs.promises.stat(filePath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", stat.size);
    const fallbackFilename = filename.replace(/"/g, '\\"');
    const encoded = encodeURIComponent(fallbackFilename);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encoded}`
    );
    res.setHeader("Cache-Control", "public, max-age=86400");
    const readStream = fs.createReadStream(filePath);
    readStream.on("error", (err) => {
      console.error("[download] stream error:", err);
      if (!res.headersSent) res.status(500).send("Failed to send file");
    });
    return readStream.pipe(res);
  } catch (err) {
    console.error("[download] error:", err);
    return res.status(404).send("Not found");
  }
});

/* ---------- View engine etc (unchanged) ---------- */
app.engine(
  "hbs",
  engine({
    extname: ".hbs",
    defaultLayout: "main",
    layoutsDir: path.join(__dirname, "views/layouts"),
    partialsDir: path.join(__dirname, "views/partials"),
    runtimeOptions: {
      allowProtoPropertiesByDefault: true,
      allowProtoMethodsByDefault: true,
    },
  })
);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI missing");
  process.exit(1);
}
await mongoose.connect(MONGODB_URI);
console.log("✅ MongoDB connected");

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGODB_URI }),
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7, secure: PROD, sameSite: "lax" },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.siteUrl = SITE_URL.replace(/\/$/, "");
  next();
});

app.use("/auth", authRoutes);
app.use("/api", apiRoutes);
app.use("/admin", adminRoutes);
app.use("/register", registerRoutes);

// mount twilio routes
import twilioRoutes from "./routes/twilio_webhook.js";
app.use("/twilio", twilioRoutes);

app.get("/", (_req, res) => {
  res.render("landing", { title: "ZimEduFinder|Best Private Schools in Zimbabwe" });
});

const PORT = process.env.PORT || 9000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 EduLocate listening on 0.0.0.0:${PORT}`);
});
