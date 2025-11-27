// server.js (full updated)
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
import twilioWebhookRoutes from "./routes/twilio_webhook3.js";

dotenv.config();
const PROD = process.env.NODE_ENV === "production";
const SITE_URL = process.env.SITE_URL || "https://skoolfinder.net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
if (PROD) app.set("trust proxy", 1);

// simple request logger (temporary — useful for diagnosing webhook reachability)
app.use((req, res, next) => {
  console.log("REQ ->", req.method, req.originalUrl, "host:", req.get("host"), "proto:", req.get("x-forwarded-proto") || req.protocol, "ip:", req.ip || req.connection?.remoteAddress);
  next();
});

/* Security & parsing */
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Quick diagnostics endpoints to confirm reachability */
// Ping to verify public/proxy routing
app.get("/twilio/ping", (req, res) => {
  console.log("PING /twilio/ping hit from", req.ip || req.get("host"));
  res.send("pong");
});

// Simple webhook that immediately logs body and headers (use for external curl / Twilio tests)
app.post("/twilio/webhook-simple", express.urlencoded({ extended: true }), (req, res) => {
  console.log("WEBHOOK-SIMPLE: Got body:", req.body, "headers:", {
    host: req.get("host"),
    "x-forwarded-proto": req.get("x-forwarded-proto"),
    "x-twilio-signature": req.header("x-twilio-signature"),
    "content-type": req.get("content-type"),
  });
  res.type("text/plain").status(200).send("OK");
});

// Load Passport strategy before routes
import "./config/passport.js";

// Optional model import for sitemap / og generation (adjust path to your model file)
import School from "./models/school.js"; // ensure this exists (or remove usage in sitemap/og)

import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import adminRoutes from "./routes/admin.js";

/* Static public */
app.use(express.static(path.join(__dirname, "public")));

/* View engine */
app.engine(
  "hbs",
  engine({
    extname: ".hbs",
    defaultLayout: "main",
    layoutsDir: path.join(__dirname, "views/layouts"),
    partialsDir: path.join(__dirname, "views/partials"),
    helpers: {
      ifeq: (a, b, opts) => (a === b ? opts.fn(this) : opts.inverse(this)),
      ifEquals: (a, b, opts) => (String(a) === String(b) ? opts.fn ? opts.fn(this) : "selected" : opts.inverse ? opts.inverse(this) : ""),
    },
    runtimeOptions: {
      allowProtoPropertiesByDefault: true,
      allowProtoMethodsByDefault: true,
    },
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

/* Expose user + siteUrl to templates */
app.use((req, res, next) => {
  res.locals.user =
    req.user?.toObject?.({ getters: true, virtuals: true }) || req.user || null;
  res.locals.siteUrl = SITE_URL.replace(/\/$/, "");
  // allow templates to set canonical path easily if not passed per-render
  res.locals.canonicalPath = req.path === "/" ? "/" : req.path;
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

// static /docs to allow direct checking; set content-type for pdfs
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

app.get("/download/:key", async (req, res) => {
  try {
    const entry = DOWNLOADS.get(req.params.key);
    if (!entry) {
      console.warn(`[download] unknown key "${req.params.key}"`);
      return res.status(404).send("Not found");
    }
    const { path: filePath, filename } = entry;

    await fs.promises.access(filePath, fs.constants.R_OK).catch((err) => {
      console.error("[download] missing:", filePath, err?.code || err);
      throw { status: 404, message: "File not found" };
    });

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
    if (err && err.status === 404) return res.status(404).send(err.message || "Not found");
    console.error("[download] unexpected error:", err);
    if (!res.headersSent) res.status(500).send("Failed to download");
  }
});

/* ---------- SEO helpers: robots + sitemap (DB-aware) ---------- */

// robots.txt — allow all, point to sitemap
app.get("/robots.txt", (req, res) => {
  const sitemapUrl = `${SITE_URL.replace(/\/$/, "")}/sitemap.xml`;
  const txt = ["User-agent: *", "Allow: /", `Sitemap: ${sitemapUrl}`, ""].join("\n");
  res.type("text/plain").send(txt);
});

// sitemap.xml — includes school pages from DB (assumes School model with slug & updatedAt)
app.get("/sitemap.xml", async (req, res) => {
  try {
    const pages = [
      { url: "/", changefreq: "weekly", priority: 1.0 },
      { url: "/recommend", changefreq: "weekly", priority: 0.8 },
      { url: "/signed-out", changefreq: "monthly", priority: 0.3 },
      { url: "/health", changefreq: "monthly", priority: 0.1 },
    ];

    // Add downloads that exist
    for (const [key, entry] of DOWNLOADS.entries()) {
      if (fs.existsSync(entry.path)) {
        pages.push({ url: `/download/${key}`, changefreq: "monthly", priority: 0.1 });
      }
    }

    // Add schools from DB if model exists
    try {
      if (School && typeof School.find === "function") {
        const schools = await School.find({ published: true }).select("slug updatedAt").lean().limit(50000);
        for (const s of schools) {
          const slug = s.slug || s._id;
          const lastmod = s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined;
          pages.push({ url: `/schools/${slug}`, changefreq: "monthly", priority: 0.6, lastmod });
        }
      }
    } catch (e) {
      console.warn("sitemap: could not query School model:", e?.message || e);
    }

    const urlsXml = pages
      .map((p) => {
        const lastmodTag = p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : "";
        return `<url><loc>${SITE_URL.replace(/\/$/, "")}${p.url}</loc>${lastmodTag}<changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`;
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

// privacy & deletion pages
app.get("/privacy-policy", (req, res) => {
  res.render("privacy_policy", {
    title: "Privacy Policy – ZimEduFinder",
    description: "Privacy policy for ZimEduFinder (Skoolfinder) - how we collect and handle data."
  });
});

app.get("/data-deletion", (req, res) => {
  res.render("data_deletion", {
    title: "Data Deletion Instructions – ZimEduFinder",
    description: "How to request deletion of your account and personal data."
  });
});

/* Routes: public landing (SEO-friendly) */
app.get("/", (_req, res) => {
  res.render("landing", {
    title: "ZimEduFinder|Best Private Schools in Zimbabwe",
    description:
      "Find and compare private schools in Zimbabwe. Search by curriculum (Cambridge, IB, ZIMSEC), fees, facilities and location. Smart school matching for parents.",
    ogTitle: "ZimEduFinder-Find the Best Private Schools in Zimbabwe",
    ogDescription:
      "Compare private schools by curriculum, fees band, facilities and location. Start with our smart matching tool.",
    ogImage: `${SITE_URL.replace(/\/$/, "")}/static/img/og-cover.jpg`,
    canonicalPath: "/",
  });
});

/* Auth / API / Admin routes */
app.use("/auth", authRoutes);
app.use("/api", apiRoutes);
app.use("/admin", adminRoutes);
app.use("/register", registerRoutes);

// Mount Twilio routes under /twilio
// Note: the twilioWebhookRoutes file expects router.post("/webhook") internally,
// so the final endpoint will be /twilio/webhook

app.use("/twilio", twilioWebhookRoutes);
/* Protected recommend page */
app.get("/recommend", ensureAuth, (req, res) => {
  res.render("recommend", {
    user: req.user,
    title: "ZimEduFinder – Private School Finder",
    description: "Answer a few questions and we'll match your child to best-fit private schools.",
    canonicalPath: "/recommend",
  });
});

app.get("/signed-out", (_req, res) => {
  res.render("signed_out", { title: "Signed out", canonicalPath: "/signed-out" });
});

// Health check
app.get("/health", (_req, res) => res.status(200).send("ok"));

/* ---------- Optional: OG image generation (requires 'canvas') ---------- */
try {
  // lazy import canvas so app still runs if canvas isn't installed
  const { createCanvas, loadImage } = await (async () => {
    try {
      return await import("canvas");
    } catch (e) {
      console.warn("canvas not available; /og/:slug.png will be disabled");
      return {};
    }
  })();

  if (createCanvas) {
    app.get("/og/:slug.png", async (req, res) => {
      try {
        const slug = req.params.slug;
        let school = null;
        try {
          school = await School.findOne({ slug }).select("name city").lean();
        } catch (e) {
          // ignore DB errors; fallback to defaults
        }
        const title = (school && school.name) ? school.name : "ZimEduFinder";
        const subtitle = (school && school.city) ? school.city : "Private schools in Zimbabwe";

        const width = 1200, height = 630;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        // Background
        ctx.fillStyle = "#003f8a";
        ctx.fillRect(0, 0, width, height);

        // Try draw logo if exists
        try {
          const logoPath = path.join(__dirname, "public", "static", "img", "logo.png");
          if (fs.existsSync(logoPath)) {
            const logoImg = await loadImage(logoPath);
            const logoW = 160;
            const logoH = (logoImg.height / logoImg.width) * logoW;
            ctx.drawImage(logoImg, 40, 40, logoW, logoH);
          }
        } catch (e) {
          // ignore logo errors
        }

        // Title wrapping
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "top";
        ctx.font = "bold 56px Sans";
        const maxWidth = width - 160;
        const words = title.split(" ");
        const lines = [];
        let line = "";
        for (const w of words) {
          const test = line ? `${line} ${w}` : w;
          if (ctx.measureText(test).width > maxWidth) {
            lines.push(line);
            line = w;
          } else {
            line = test;
          }
        }
        if (line) lines.push(line);

        let y = 220;
        for (const l of lines.slice(0, 3)) {
          ctx.fillText(l, 40, y);
          y += 72;
        }

        // Subtitle
        ctx.font = "400 34px Sans";
        ctx.fillStyle = "#dbe9ff";
        ctx.fillText(subtitle, 40, y + 12);

        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        canvas.pngStream().pipe(res);
      } catch (e) {
        console.error("og image error:", e);
        res.status(500).send("og image generation failed");
      }
    });
  }
} catch (e) {
  console.warn("OG image setup skipped:", e?.message || e);
}

app.get("/diag/env", (req, res) => {
  res.json({
    TWILIO_ACCOUNT_SID: (process.env.TWILIO_ACCOUNT_SID || "").slice(0,6) + "...",
    TWILIO_AUTH_TOKEN: (process.env.TWILIO_AUTH_TOKEN || "").slice(0,6) + "...",
    SITE_URL: process.env.SITE_URL || null,
    DEBUG_TWILIO_SKIP_VERIFY: process.env.DEBUG_TWILIO_SKIP_VERIFY || null,
  });
});



const PORT = process.env.PORT || 9000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 EduLocate listening on 0.0.0.0:${PORT}`);
});
