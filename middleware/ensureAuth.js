// middleware/ensureAuth.js
export function ensureAuth(req, res, next) {
  // Passport adds isAuthenticated()
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  // remember where the user wanted to go
  if (req.session) {
    req.session.returnTo = req.originalUrl || "/recommend";
  }
  return res.redirect("/auth/google");
}
