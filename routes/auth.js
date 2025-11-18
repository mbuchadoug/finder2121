// routes/auth.js
import { Router } from "express";
import passport from "passport";

const router = Router();

function isFacebookInApp(req) {
  const ua = String(req.get("user-agent") || "").toLowerCase();
  const ref = String(req.get("referer") || "").toLowerCase();

  // Common signs of Facebook / Messenger / Instagram in-app browsers:
  // - UA contains 'fbav' or 'fban' (facebook app)
  // - UA contains 'facebook' or 'messenger'
  // - Referer contains 'facebook.com' (clicked from facebook)
  // - Instagram in-app browser also often used for links from Instagram
  if (/\bfbav\b|\bfban\b|facebook|messenger|instagram/i.test(ua)) return true;
  if (ref.includes("facebook.com") || ref.includes("m.facebook.com") || ref.includes("l.facebook.com")) return true;

  return false;
}

/**
 * GET /signin
 * - optional query: ?returnTo=/some/path
 * - decides which provider to use and redirects to /auth/facebook or /auth/google
 */
router.get("/signin", (req, res, next) => {
  // Save returnTo in session (prefer explicit query, then referer, then root)
  const returnTo = req.query.returnTo || req.get("referer") || req.session?.returnTo || "/";
  if (req.session) req.session.returnTo = returnTo;

  // if already authenticated, just redirect back
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.redirect(returnTo);
  }

  const useFacebook = isFacebookInApp(req);
  const facebookConfigured = !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET && process.env.FACEBOOK_CALLBACK_URL);
  const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL);

  if (useFacebook && facebookConfigured) {
    // start facebook oauth
    return res.redirect("/auth/facebook");
  }

  // If facebook detection but facebook not configured, prefer google if configured
  if (useFacebook && !facebookConfigured && googleConfigured) {
    return res.redirect("/auth/google");
  }

  // Not facebook in-app (or facebook not detected) -> prefer Google if available
  if (googleConfigured) {
    return res.redirect("/auth/google");
  }

  // If neither provider configured, render a simple chooser page (helpful for dev)
  if (!facebookConfigured && !googleConfigured) {
    return res.send(`
      <h2>Sign in</h2>
      <p>No OAuth providers are configured on this server.</p>
      <p>Set FACEBOOK_APP_ID/SECRET/CALLBACK_URL or GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL in your environment.</p>
    `);
  }

  // fallback: if google not configured but facebook is, use facebook
  if (!googleConfigured && facebookConfigured) {
    return res.redirect("/auth/facebook");
  }

  // final fallback redirect to google
  return res.redirect("/auth/google");
});

/* ----- Google ----- */
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    const redirectTo = req.session?.returnTo || "/recommend";
    if (req.session) delete req.session.returnTo;
    res.redirect(redirectTo);
  }
);

/* ----- Facebook ----- */
// Start Facebook OAuth (public profile only)
router.get("/facebook", passport.authenticate("facebook", { scope: ["public_profile", "email"] }));

// Facebook callback URL
router.get(
  "/facebook/callback",
  passport.authenticate("facebook", { failureRedirect: "/" }),
  (req, res) => {
    const redirectTo = req.session?.returnTo || "/recommend";
    if (req.session) delete req.session.returnTo;
    res.redirect(redirectTo);
  }
);

/* ----- Logout ----- */
router.post("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.redirect("/signed-out");
    });
  });
});

router.get("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.redirect("/recommend");
    });
  });
});

export default router;
