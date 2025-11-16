import { Router } from "express";
import passport from "passport";

const router = Router();

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/recommend" }),
  (req, res) => {
    // Redirect user to where they were trying to go, or /recommend by default
    const redirectTo = req.session.returnTo || "/recommend";
    delete req.session.returnTo;
    res.redirect(redirectTo);
  }
);

// POST /auth/logout
router.post("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.redirect("/signed-out");   // <-- go somewhere NOT protected
    });
  });
});


// Optional GET route if you want <a href="/auth/logout">
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
