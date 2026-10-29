// ============================================
// FILE: src/controllers/vapi.controller.ts
// PURPOSE: Handle outbound voice calls & call status tracking
// ============================================

import type { Request, Response, NextFunction } from "express";
import User from "../models/user.model.ts";
import {
  initiateOutboundCall,
  getVapiCallStatus,
  VapiServiceError,
} from "../services/vapi.service.ts";
import { formatAndValidatePhone } from "../utils/phone.util.ts";

// In-memory call ownership tracking (callId -> { userId, timestamp })
const callOwnershipMap = new Map<string, { userId: string; timestamp: number }>();

// In-memory user call cooldown tracking (userId -> lastInitiateTimestamp) to prevent duplicate paid calls
const userLastCallMap = new Map<string, number>();
const CALL_COOLDOWN_MS = 15000; // 15-second minimum interval between calls per student

// Purge entries older than 24 hours every hour
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, record] of callOwnershipMap.entries()) {
    if (record.timestamp < cutoff) {
      callOwnershipMap.delete(id);
    }
  }
  for (const [uid, timestamp] of userLastCallMap.entries()) {
    if (timestamp < cutoff) {
      userLastCallMap.delete(uid);
    }
  }
}, 60 * 60 * 1000).unref();

// POST /api/vapi/call
export const startCall = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { phoneNumber, preferredCourse, queryTopic } = req.body;

    const validation = formatAndValidatePhone(phoneNumber);
    if (!validation.isValid || !validation.e164) {
      res.status(400).json({
        success: false,
        message: validation.error || "Valid phone number is required.",
      });
      return;
    }

    const currentUser = (req as any).user;
    if (!currentUser?.userId) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    // Rate-limit / Cooldown check: prevent duplicate accidental paid calls
    const now = Date.now();
    const lastCallTimestamp = userLastCallMap.get(currentUser.userId) || 0;
    if (now - lastCallTimestamp < CALL_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((CALL_COOLDOWN_MS - (now - lastCallTimestamp)) / 1000);
      res.status(429).json({
        success: false,
        message: `Please wait ${waitSeconds}s before requesting another call to prevent duplicate charges.`,
      });
      return;
    }

    const user = await User.findById(currentUser.userId).select("name email");
    if (!user) {
      res.status(404).json({ success: false, message: "Student account not found." });
      return;
    }

    const result = await initiateOutboundCall({
      phoneNumber: validation.e164,
      userName: user.name,
      userEmail: user.email,
      preferredCourse: typeof preferredCourse === "string" ? preferredCourse.trim() : undefined,
      queryTopic: typeof queryTopic === "string" ? queryTopic.trim() : undefined,
    });

    // Record ownership and update cooldown timestamp
    userLastCallMap.set(currentUser.userId, now);
    callOwnershipMap.set(result.id, {
      userId: currentUser.userId,
      timestamp: now,
    });

    res.status(200).json({
      success: true,
      message: "Call initiated. You will receive a call shortly.",
      data: {
        callId: result.id,
        status: result.status,
        destination: result.maskedNumber,
      },
    });
  } catch (error) {
    if (error instanceof VapiServiceError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
};

// GET /api/vapi/call/:id
export const getCallStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawId = req.params.id;
    const callId = Array.isArray(rawId) ? rawId[0] : rawId;
    const currentUser = (req as any).user;

    if (!callId) {
      res.status(400).json({ success: false, message: "Call ID is required." });
      return;
    }

    // Strict IDOR ownership check
    const ownership = callOwnershipMap.get(callId);
    if (!ownership) {
      res.status(404).json({
        success: false,
        message: "Call record not found or access expired.",
      });
      return;
    }

    if (ownership.userId !== currentUser?.userId) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to view status for this call.",
      });
      return;
    }

    const statusResult = await getVapiCallStatus(callId);

    res.status(200).json({
      success: true,
      data: statusResult,
    });
  } catch (error) {
    if (error instanceof VapiServiceError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
};
