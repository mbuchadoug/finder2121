// routes/auth.js
import { Router } from "express";
import passport from "passport";

const router = Router();

/* ----- Google ----- */
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    // Redirect user to where they were trying to go, or /recommend by default
    const redirectTo = req.session?.returnTo || "/recommend";
    if (req.session) delete req.session.returnTo;
    res.redirect(redirectTo);
  }
);

/* ----- Facebook ----- */
// Start Facebook OAuth (request email)
//router.get("/facebook", passport.authenticate("facebook", { scope: ["email"] }));

// Start Facebook OAuth (public profile only — works immediately)
router.get("/facebook", passport.authenticate("facebook", { scope: ["public_profile"] }));


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

// Optional GET logout (if you want <a href="/auth/logout">)
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
