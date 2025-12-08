// config/passport.js
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import User from "../models/user.js";
import dotenv from "dotenv";
dotenv.config();

const ADMIN_SET = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

// --- Google Strategy (existing behaviour) ---
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          const role = ADMIN_SET.has(email) ? "admin" : "user";

          let user = await User.findOne({ provider: "google", providerId: profile.id });
          if (user) {
            // keep role in sync if email is in ADMIN_EMAILS
            if (user.role !== role) {
              user.role = role;
              await user.save();
            }
            return done(null, user);
          }

          // try to find by email and attach Google provider if user exists
          if (email) {
            const existing = await User.findOne({ email });
            if (existing) {
              existing.provider = "google";
              existing.providerId = profile.id;
              existing.name = existing.name || profile.displayName;
              existing.photo = existing.photo || profile.photos?.[0]?.value;
              existing.role = role;
              await existing.save();
              return done(null, existing);
            }
          }

          user = await User.create({
            provider: "google",
            providerId: profile.id,
            name: profile.displayName,
            email,
            photo: profile.photos?.[0]?.value,
            role,
          });
          return done(null, user);
        } catch (e) {
          done(e);
        }
      }
    )
  );
} else {
  console.warn("Google credentials not configured; skipping GoogleStrategy");
}

// --- Facebook Strategy ---
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET && process.env.FACEBOOK_CALLBACK_URL) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_CALLBACK_URL,
        profileFields: ["id", "emails", "name", "picture.type(large)"],
      },
      async (accessToken, _refreshToken, profile, done) => {
        try {
          // Facebook may not always return email; guard accordingly
          const email = profile.emails?.[0]?.value?.toLowerCase();
          const role = ADMIN_SET.has(email) ? "admin" : "user";

          // 1) find by provider/providerId
          let user = await User.findOne({ provider: "facebook", providerId: profile.id });
          if (user) {
            if (user.role !== role) {
              user.role = role;
              await user.save();
            }
            return done(null, user);
          }

          // 2) if no provider match, try to find existing user by email and attach facebook provider
          if (email) {
            const existing = await User.findOne({ email });
            if (existing) {
              existing.provider = "facebook";
              existing.providerId = profile.id;
              existing.name = existing.name || `${profile.name?.givenName || ""} ${profile.name?.familyName || ""}`.trim();
              existing.photo = existing.photo || profile.photos?.[0]?.value;
              existing.role = role;
              await existing.save();
              return done(null, existing);
            }
          }

          // 3) else create new user record
          const displayName =
            profile.displayName ||
            `${profile.name?.givenName || ""} ${profile.name?.familyName || ""}`.trim() ||
            null;

          user = await User.create({
            provider: "facebook",
            providerId: profile.id,
            name: displayName,
            email: email || undefined,
            photo: profile.photos?.[0]?.value,
            role,
          });

          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );
} else {
  console.warn("Facebook credentials not configured; skipping FacebookStrategy");
}

// --- Passport session handling ---
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const u = await User.findById(id).lean({ getters: true, virtuals: true });
    done(null, u);
  } catch (e) {
    done(e);
  }
});

export default passport;
