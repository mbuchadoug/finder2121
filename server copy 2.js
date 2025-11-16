// server.js (updated)
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
import { pipeline } from "stream";
import { promisify } from "util";

dotenv.config();
const PROD = process.env.NODE_ENV === "production";
const SITE_URL = process.env.SITE_URL || "https://skoolfinder.net";

const pipe = promisify(pipeline);

// Load Passport strategy before routes
import "./config/passport.js";

import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import adminRoutes from "./routes/admin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
if (PROD) app.set("trust proxy", 1);

/* Security & parsing */
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Static public (root) */
app.use(express.static(path.join(__dirname, "public")));

/* Views (Handlebars) */
app.engine(
  "hbs",
  engine({
    extname: ".hbs",
    defaultLayout: "main",
    layoutsDir: path.join(__dirname, "views/layouts"),
    partialsDir: path.join(__dirname, "views/partials"),
    helpers: {
      ifeq: (a, b, opts) => (a === b ? opts.fn(this) : opts.inverse(this)),
    },
    runtimeOptions: { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true },
  })
);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

/* Mongo */
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI missing in .env");
  process.exit(1);
}
await mongoose.connect(MONGODB_URI);
console.log("✅ MongoDB connected");

/* Sessions */
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    unset: "destroy",
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      autoRemove: "native",
      disableTouch: true,
    }),
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      secure: PROD,
      sameSite: "lax",
    },
  })
);

/* Passport */
app.use(passport.initialize());
app.use(passport.session());

/* Expose a safe user to views */
app.use((req, res, next) => {
  res.locals.user =
    req.user?.toObject?.({ getters: true, virtuals: true }) || req.user || null;
  next();
});

/* Diagnostics */
app.get("/whoami", (req, res) => res.json(req.user || null));

/* Optional: image proxy for logos/og images */
app.get("/img", async (req, res) => {
  try {
    const url = req.query.u;
    if (!url) return res.status(400).send("Missing u");
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return res.status(400).send("Bad protocol");
    const r = await axios.get(u.toString(), {
      responseType: "arraybuffer",
      maxRedirects: 5,
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (EduLocate/1.0)" },
    });
    res.setHeader("Content-Type", r.headers["content-type"] || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(r.data));
  } catch (e) {
    console.error("img proxy error:", e?.message);
    res.status(502).send("img fetch failed");
  }
});

/* ---------- Docs / downloads ---------- */
const DOCS_DIR = path.join(__dirname, "public", "docs");

// Map of download keys -> file path + client filename
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
]);

// static /docs to allow direct checking; make sure content-type is pdf
app.use(
  "/docs",
  express.static(DOCS_DIR, {
    setHeaders: (res, filePath) => {
      // Ensure PDF files served from /docs have the right content-type
      if (filePath && filePath.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    },
  })
);

// live diagnostics: see what the server sees
app.get("/diag/downloads", (_req, res) => {
  const report = {};
  for (const [key, entry] of DOWNLOADS.entries()) {
    const exists = fs.existsSync(entry.path);
    let size = null,
      mtime = null;
    if (exists) {
      const st = fs.statSync(entry.path);
      size = st.size;
      mtime = st.mtime;
    }
    report[key] = { path: entry.path, exists, size, mtime, filename: entry.filename };
  }
  res.json({
    cwd: process.cwd(),
    docsDir: DOCS_DIR,
    report,
  });
});

/*
  Robust download endpoint:
  - streams the file with correct headers
  - sends explicit Content-Type + Content-Disposition
  - returns clear 404/500 messages (no HTML fallback)
  - avoids express.static collisions for download-by-key
*/
app.get("/download/:key", async (req, res) => {
  try {
    const entry = DOWNLOADS.get(req.params.key);
    if (!entry) {
      console.warn(`[download] unknown key "${req.params.key}"`);
      return res.status(404).send("Not found");
    }
    const { path: filePath, filename } = entry;

    // check file exists and is readable
    await fs.promises.access(filePath, fs.constants.R_OK).catch((err) => {
      console.error("[download] missing:", filePath, err?.code || err);
      throw { status: 404, message: "File not found" };
    });

    const stat = await fs.promises.stat(filePath);

    // set explicit headers (content-length + content-type + disposition)
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", stat.size);
    // Content-Disposition - use RFC5987 encoding for non-ascii filenames
    const fallbackFilename = filename.replace(/"/g, '\\"');
    const encoded = encodeURIComponent(fallbackFilename);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encoded}`
    );
    res.setHeader("Cache-Control", "public, max-age=86400");

    // stream the file (robust)
    const readStream = fs.createReadStream(filePath);
    readStream.on("error", (err) => {
      console.error("[download] stream error:", err);
      if (!res.headersSent) res.status(500).send("Failed to send file");
    });
    return readStream.pipe(res);
  } catch (err) {
    if (err && err.status === 404) return res.status(404).send(err.message || "Not found");
    console.error("[download] unexpected error:", err);
    if (!res.headersSent) res.status(500).send("Failed to download");
  }
});

/* ---------- SEO helpers: robots + sitemap ---------- */

// robots.txt — allow all, point to sitemap
app.get("/robots.txt", (req, res) => {
  const sitemapUrl = `${SITE_URL.replace(/\/$/, "")}/sitemap.xml`;
  const txt = [
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");
  res.type("text/plain").send(txt);
});

// Simple dynamic sitemap.xml (add more URLs if your site has pages)
// If you have dynamic school pages, extend this to generate from DB.
app.get("/sitemap.xml", async (req, res) => {
  try {
    // Root static pages - add others you want indexed
    const pages = [
      { url: "/", changefreq: "weekly", priority: 1.0 },
      { url: "/recommend", changefreq: "weekly", priority: 0.8 },
      { url: "/signed-out", changefreq: "monthly", priority: 0.3 },
      { url: "/health", changefreq: "monthly", priority: 0.1 },
    ];

    // include docs that exist
    for (const [key, entry] of DOWNLOADS.entries()) {
      if (fs.existsSync(entry.path)) {
        pages.push({ url: `/download/${key}`, changefreq: "monthly", priority: 0.1 });
      }
    }

    const urlsXml = pages
      .map((p) => {
        return `<url><loc>${SITE_URL.replace(/\/$/, "")}${p.url}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`;
      })
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${urlsXml}
    </urlset>`;

    res.type("application/xml").send(xml);
  } catch (e) {
    console.error("sitemap error:", e);
    res.status(500).send("sitemap generation failed");
  }
});

/* Routes: public landing (SEO-friendly) */
app.get("/", (_req, res) => {
  res.render("landing", { title: "Skoolfinder — Private Schools in Zimbabwe" });
});

/* Auth / API / Admin routes */
app.use("/auth", authRoutes);
app.use("/api", apiRoutes);
app.use("/admin", adminRoutes);

/* Protected recommend page */
app.get("/recommend", ensureAuth, (req, res) => {
  res.render("recommend", {
    user: req.user,
    title: "EduLocate – Private School Finder",
  });
});

app.get("/signed-out", (_req, res) => {
  res.render("signed_out", { title: "Signed out" });
});

// Health check
app.get("/health", (_req, res) => res.status(200).send("ok"));

const PORT = process.env.PORT || 9000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 EduLocate listening on 0.0.0.0:${PORT}`);
});
