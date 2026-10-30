// ============================================
// FILE: src/controllers/vapi.controller.ts
// PURPOSE: Persistent MongoDB-backed Vapi call tracking, atomic idempotency & status polling
// ============================================

import type { Request, Response, NextFunction } from "express";
import User from "../models/user.model.ts";
import CallRecord from "../models/call.model.ts";
import {
  initiateOutboundCall,
  getVapiCallStatus,
  VapiServiceError,
} from "../services/vapi.service.ts";
import { formatAndValidatePhone, maskPhoneNumber } from "../utils/phone.util.ts";

const CALL_COOLDOWN_MS = 15000; // 15-second minimum interval between calls per student

// POST /api/vapi/call
export const startCall = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let lockAcquired = false;
  let callRecordId: string | null = null;
  const currentUser = (req as any).user;

  try {
    const { phoneNumber, preferredCourse, queryTopic, idempotencyKey } = req.body;

    if (!currentUser?.userId) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const validation = formatAndValidatePhone(phoneNumber);
    if (!validation.isValid || !validation.e164) {
      res.status(400).json({
        success: false,
        message: validation.error || "Valid phone number is required.",
      });
      return;
    }

    const sanitizedIdempotencyKey =
      typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0
        ? idempotencyKey.trim().slice(0, 100)
        : undefined;

    // Layer 1: Check Idempotency Key (Return existing record if already processed or in-flight)
    if (sanitizedIdempotencyKey) {
      const existingRecord = await CallRecord.findOne({
        userId: currentUser.userId,
        idempotencyKey: sanitizedIdempotencyKey,
      });

      if (existingRecord) {
        const requestedMasked = maskPhoneNumber(validation.e164);
        const existingCourse = (existingRecord.preferredCourse || "").trim();
        const requestedCourse = typeof preferredCourse === "string" ? preferredCourse.trim() : "";
        const existingTopic = (existingRecord.queryTopic || "").trim();
        const requestedTopic = typeof queryTopic === "string" ? queryTopic.trim() : "";

        // Payload consistency check: reject reuse with different payload
        if (
          existingRecord.destination !== requestedMasked ||
          existingCourse !== requestedCourse ||
          existingTopic !== requestedTopic
        ) {
          res.status(409).json({
            success: false,
            message: "Idempotency key was previously used with a different request payload.",
          });
          return;
        }

        if (existingRecord.status === "initiating") {
          res.status(409).json({
            success: false,
            message: "A call for this request is currently being initiated. Please wait.",
          });
          return;
        }

        res.status(200).json({
          success: true,
          message: "Call already initiated.",
          data: {
            callId: existingRecord.callId,
            status: existingRecord.status,
            destination: existingRecord.destination,
          },
        });
        return;
      }
    }

    // Layer 2: Atomic Cooldown & In-Flight Lock on User Document
    // Single-document atomic update prevents race conditions across concurrent requests
    const now = new Date();
    const cooldownTime = new Date(now.getTime() + CALL_COOLDOWN_MS);

    const lockedUser = await User.findOneAndUpdate(
      {
        _id: currentUser.userId,
        $or: [
          { callLockUntil: { $exists: false } },
          { callLockUntil: null },
          { callLockUntil: { $lte: now } },
        ],
      },
      {
        $set: { callLockUntil: cooldownTime },
      },
      {
        returnDocument: "after",
      }
    ).select("name email callLockUntil");

    if (!lockedUser) {
      // Lock could not be acquired because another call was recently initiated or is in progress
      const userDoc = await User.findById(currentUser.userId).select("callLockUntil");
      if (!userDoc) {
        res.status(404).json({ success: false, message: "Student account not found." });
        return;
      }

      const lockUntil = userDoc.callLockUntil ? userDoc.callLockUntil.getTime() : 0;
      const waitSeconds = Math.max(1, Math.ceil((lockUntil - Date.now()) / 1000));

      res.status(429).json({
        success: false,
        message: `Please wait ${waitSeconds}s before requesting another call to prevent duplicate charges.`,
      });
      return;
    }

    lockAcquired = true;

    // Create persistent CallRecord in MongoDB
    const newCallData: Record<string, any> = {
      userId: currentUser.userId,
      destination: maskPhoneNumber(validation.e164),
      status: "initiating",
    };
    if (typeof preferredCourse === "string" && preferredCourse.trim()) {
      newCallData.preferredCourse = preferredCourse.trim();
    }
    if (typeof queryTopic === "string" && queryTopic.trim()) {
      newCallData.queryTopic = queryTopic.trim();
    }
    if (sanitizedIdempotencyKey) {
      newCallData.idempotencyKey = sanitizedIdempotencyKey;
    }

    const callRecord = await CallRecord.create(newCallData);
    callRecordId = (callRecord._id as any).toString();

    // Call external Vapi API
    const result = await initiateOutboundCall({
      phoneNumber: validation.e164,
      userName: lockedUser.name,
      userEmail: lockedUser.email,
      preferredCourse: typeof preferredCourse === "string" ? preferredCourse.trim() : undefined,
      queryTopic: typeof queryTopic === "string" ? queryTopic.trim() : undefined,
      userId: currentUser.userId,
      idempotencyKey: sanitizedIdempotencyKey,
    });

    // Update CallRecord with assigned callId and initial provider status
    callRecord.callId = result.id;
    callRecord.status = (result.status as any) || "queued";
    await callRecord.save();

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
    const isAmbiguous = error instanceof VapiServiceError && error.isAmbiguous;

    // If call failed definitively (NOT ambiguous), release the lock immediately so student can retry.
    // If the error was AMBIGUOUS (e.g. timeout where provider outcome could not be verified),
    // KEEP the lock active for the remainder of the 15-second cooldown to strictly prevent duplicate paid calls!
    if (!isAmbiguous && lockAcquired && currentUser?.userId) {
      await User.findByIdAndUpdate(currentUser.userId, { $set: { callLockUntil: null } }).catch(() => {});
    }

    // Mark call record as failed if it was created
    if (callRecordId) {
      await CallRecord.findByIdAndUpdate(callRecordId, {
        $set: {
          status: "failed",
          endedReason: isAmbiguous
            ? "Ambiguous timeout: provider outcome unverified"
            : error instanceof Error
              ? error.message.slice(0, 200)
              : "Initiation error",
        },
      }).catch(() => {});
    }

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

    if (!currentUser?.userId) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    // Persistent MongoDB Ownership Check (survives server restarts)
    const callRecord = await CallRecord.findOne({ callId });
    if (!callRecord) {
      res.status(404).json({
        success: false,
        message: "Call record not found or access expired.",
      });
      return;
    }

    if (callRecord.userId.toString() !== currentUser.userId) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to view status for this call.",
      });
      return;
    }

    // Retrieve live status from Vapi
    const statusResult = await getVapiCallStatus(callId);

    // Sync latest status to MongoDB
    if (
      statusResult.status !== callRecord.status ||
      statusResult.endedReason !== callRecord.endedReason
    ) {
      callRecord.status = statusResult.status;
      if (statusResult.endedReason) {
        callRecord.endedReason = statusResult.endedReason;
      }
      await callRecord.save().catch(() => {});
    }

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
