// ============================================
// FILE: src/app.ts
// PURPOSE: Configure Express — middleware, routes, error handling
// ============================================

import express from "express";
import type { Application, Request, Response } from "express";
import cors from "cors";
import corsOptions from "./config/cors.config.ts";
import chatRoutes from "./routes/chat.routes.ts";
import authRoutes from "./routes/auth.routes.ts";
import vapiRoutes from "./routes/vapi.routes.ts";
import errorHandler from "./middleware/error-handler.middleware.ts";

const app: Application = express();

// CORS Middleware
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health Check Endpoints (mounted before API routes & 404 handler)
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "EduReach Backend Running Successfully",
  });
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/vapi", vapiRoutes);

// Catch-all 404 handler for unknown routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

// Global error handler (must be last)
app.use(errorHandler);

export default app;
