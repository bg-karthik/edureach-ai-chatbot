// ============================================
// FILE: src/models/call.model.ts
// PURPOSE: Persistent MongoDB Call Records with TTL retention and user-scoping
// ============================================

import mongoose, { Schema, Document, Types } from "mongoose";

export type CallRecordStatus =
  | "initiating"
  | "queued"
  | "ringing"
  | "in-progress"
  | "ended"
  | "failed"
  | "unknown";

export interface ICallRecord extends Document {
  userId: Types.ObjectId;
  callId?: string | undefined;
  destination: string;
  status: CallRecordStatus;
  endedReason?: string | undefined;
  preferredCourse?: string | undefined;
  queryTopic?: string | undefined;
  idempotencyKey?: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

const CallRecordSchema: Schema<ICallRecord> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },
    callId: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },
    destination: {
      type: String,
      required: [true, "Masked destination phone number is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["initiating", "queued", "ringing", "in-progress", "ended", "failed", "unknown"],
      default: "initiating",
      index: true,
    },
    endedReason: {
      type: String,
      trim: true,
    },
    preferredCourse: {
      type: String,
      trim: true,
    },
    queryTopic: {
      type: String,
      trim: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      sparse: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 30 * 24 * 60 * 60, // 30-day retention TTL index
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

// Compound Unique Index: Prevents duplicate call creation with the same idempotencyKey per user
CallRecordSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, name: "user_idempotency_unique" }
);

const CallRecord = mongoose.model<ICallRecord>("CallRecord", CallRecordSchema);

export default CallRecord;
