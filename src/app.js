import express from "express";
import cors from "cors";
import helmet from "helmet";
import gameRoutes from "./routes/gameRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();

const rawFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const FRONTEND_ORIGIN = rawFrontendUrl.replace(/\/+$/, "");

app.use(helmet());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true
}));

app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || "1mb"
}));

app.use("/api/auth", authRoutes);
app.use("/api/game", requireAuth, gameRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res, next) => {
  res.status(404).json({ message: "Not Found" });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ message });
});

export default app;
