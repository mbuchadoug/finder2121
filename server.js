import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import passport from "passport";
import helmet from "helmet";
//import { engine } from "express-handlebars";
import axios from "axios";
import { engine } from "express-handlebars";
import { ensureAuth } from "./middleware/ensureAuth.js";
import MongoStore from "connect-mongo";
import session from "express-session";

// ...



dotenv.config();
const PROD = process.env.NODE_ENV === "production";


// Load Passport strategy before routes
import "./config/passport.js";

import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import adminRoutes from "./routes/admin.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
if (PROD) app.set("trust proxy", 1); // needed for secure cookies behind Render proxy


/* Security & parsing */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Static */
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
    unset: "destroy",                         // if session is destroyed, also clear cookie
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      autoRemove: "native",
      // prevent "Unable to find the session to touch" noise when the doc is gone
      disableTouch: true,                     // <— key line
      // (optional) ttl: 60 * 60 * 24 * 7,     // align with cookie maxAge if you want
    }),
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 days
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
  } catch {
    res.status(502).send("img fetch failed");
  }
});

/* Routes */
app.get("/", (_req, res) => res.redirect("/recommend"));
app.use("/auth", authRoutes);
app.use("/api", apiRoutes);
app.use("/admin", adminRoutes);


/*app.get("/recommend", (_req, res) => {
  res.render("recommend", {
    title: "EduLocate – Private School Finder",
  });
});*/



app.get("/recommend", ensureAuth, (req, res) => {
  res.render("recommend", {
    user: req.user,
    title: "EduLocate – Private School Finder",
  });
});

app.get("/signed-out", (_req, res) => {
  res.render("signed_out", { title: "Signed out" });
});

// Health check (helps Render detect the service)
app.get("/health", (_req, res) => res.status(200).send("ok"));

const PORT = process.env.PORT || 9000;
// IMPORTANT: bind to 0.0.0.0 on Render
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 EduLocate listening on 0.0.0.0:${PORT}`);
});
