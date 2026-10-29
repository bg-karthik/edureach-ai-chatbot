// ============================================
// FILE: src/config/cors.config.ts
// PURPOSE: Centralized, secure CORS configuration
// ============================================

import type { CorsOptions } from "cors";

const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://localhost:3000",
];

/**
 * Returns the list of permitted origins based on environment.
 * In development, includes local Vite / React dev servers.
 * In production, strictly reads from CLIENT_URL (supports comma-separated origins).
 */
export const getAllowedOrigins = (): string[] => {
  const allowed = new Set<string>();

  // 1. Configured origins from process.env.CLIENT_URL (comma-separated support)
  if (process.env.CLIENT_URL) {
    const urls = process.env.CLIENT_URL.split(",");
    for (const url of urls) {
      const trimmed = url.trim().replace(/\/+$/, "");
      if (trimmed) {
        allowed.add(trimmed);
      }
    }
  }

  // 2. Permit localhost development origins ONLY in development mode
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    for (const devOrigin of DEV_ORIGINS) {
      allowed.add(devOrigin);
    }
  }

  return Array.from(allowed);
};

export const corsOptions: CorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow non-browser requests (e.g. server-to-server, curl, health checks)
    if (!origin) {
      return callback(null, true);
    }

    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS policy violation: Origin '${origin}' is not allowed.`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

export default corsOptions;

