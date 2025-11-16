import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/user.js";
import dotenv from "dotenv";
dotenv.config();

const ADMIN_SET = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

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

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const u = await User.findById(id).lean({ getters: true, virtuals: true });
    done(null, u);
  } catch (e) {
    done(e);
  }
});
