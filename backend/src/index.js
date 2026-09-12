import "dotenv/config";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import doctorRoutes from "./routes/doctors.js";
import referralRoutes from "./routes/referrals.js";
import staffRoutes from "./routes/staff.js";
import hospitalRoutes from "./routes/hospitals.js";
import dashboardRoutes from "./routes/dashboard.js";
import marketingPersonRoutes from "./routes/marketingPersons.js";
import activityLogRoutes from "./routes/activityLog.js";
import ocrRoutes from "./routes/ocr.js";

const app = express();

// This is a live operational API — every response reflects real-time patient/credit/payout
// status, so a stale response is actively misleading, never just a minor inefficiency.
// Express generates an ETag for every response by default, which is normally a nice
// performance win for static-ish content — but it actively works against an app like this:
// the browser sends a conditional request next time, and if the freshly-computed response
// happens to hash the same as last time (or the browser's own heuristics decide to reuse a
// cached copy), the user silently sees old data with no visual indication anything was
// skipped. This is exactly what caused referrals with an unpaid credit to disappear from the
// "All Referrals" list for one admin's browser while the underlying data was always correct.
// Disabling etag + explicitly marking every response no-store closes that off entirely.
app.set("etag", false);
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/hospitals", hospitalRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/marketing-persons", marketingPersonRoutes);
app.use("/api/activity-log", activityLogRoutes);
app.use("/api/ocr", ocrRoutes);

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Referral system API running on port ${port}`));
