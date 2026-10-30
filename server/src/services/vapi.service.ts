// ============================================
// FILE: src/services/vapi.service.ts
// PURPOSE: Secure integration with Vapi Voice AI (no secret logging, E.164 validation, status tracking)
// ============================================

import { formatAndValidatePhone, maskPhoneNumber, sanitizeLogMessage } from "../utils/phone.util.ts";

export interface OutboundCallRequest {
  phoneNumber: string;
  userName: string;
  userEmail?: string | undefined;
  preferredCourse?: string | undefined;
  queryTopic?: string | undefined;
  userId?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface VapiCallResult {
  id: string;
  status: string;
  maskedNumber: string;
}

export interface VapiCallStatusResult {
  id: string;
  status: "queued" | "ringing" | "in-progress" | "ended" | "unknown";
  endedReason?: string | undefined;
  displayStatus: string;
  isFinished: boolean;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
}

export class VapiServiceError extends Error {
  statusCode: number;
  isAmbiguous: boolean;

  constructor(message: string, statusCode: number = 500, isAmbiguous: boolean = false) {
    super(message);
    this.name = "VapiServiceError";
    this.statusCode = statusCode;
    this.isAmbiguous = isAmbiguous;
  }
}

const CALL_INITIATION_TIMEOUT_MS = 12000; // 12 seconds
const CALL_STATUS_TIMEOUT_MS = 8000; // 8 seconds

export interface FindRecentCallCriteria {
  phoneNumber: string;
  userId?: string | undefined;
  idempotencyKey?: string | undefined;
  initiatedAt: number;
  maxAgeMs?: number | undefined;
}

/**
 * Searches recent calls on Vapi to resolve ambiguous timeout outcomes.
 * Uses only officially documented Vapi query parameters (assistantId, phoneNumberId, limit, createdAtGt).
 * Never assumes destination phone number is a server-side filter.
 * Strictly verifies assistantId, phoneNumberId, customer number, metadata.userId, metadata.idempotencyKey,
 * and creation timestamp before associating any call.
 * If ownership or correlation remains ambiguous, returns null to fail safely.
 */
export const findRecentCallForCustomer = async (
  criteria: FindRecentCallCriteria
): Promise<{ id: string; status: string } | null> => {
  const { phoneNumber, userId, idempotencyKey, initiatedAt, maxAgeMs = 45000 } = criteria;
  const VAPI_API_KEY = process.env.VAPI_API_KEY;
  const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
  const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;

  if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID || !VAPI_PHONE_NUMBER_ID) return null;

  try {
    // Pass only officially documented Vapi GET /call query parameters:
    // assistantId, phoneNumberId, limit, createdAtGt
    const createdAtGt = new Date(Math.max(0, initiatedAt - 15000)).toISOString();
    const queryParams = new URLSearchParams({
      assistantId: VAPI_ASSISTANT_ID,
      phoneNumberId: VAPI_PHONE_NUMBER_ID,
      limit: "20",
      createdAtGt,
    });

    const res = await fetch(`https://api.vapi.ai/call?${queryParams.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
      signal: AbortSignal.timeout(CALL_STATUS_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const calls = (await res.json()) as Array<{
      id: string;
      assistantId?: string;
      phoneNumberId?: string;
      status?: string;
      customer?: { number?: string };
      metadata?: { userId?: string; idempotencyKey?: string };
      createdAt?: string;
    }>;

    if (!Array.isArray(calls) || calls.length === 0) return null;

    const now = Date.now();
    const matchingCalls: Array<{ id: string; status: string }> = [];

    for (const call of calls) {
      // 1. Destination customer number check
      if (call.customer?.number !== phoneNumber) continue;

      // 2. Assistant ID & Phone Number ID check
      if (call.assistantId && call.assistantId !== VAPI_ASSISTANT_ID) continue;
      if (call.phoneNumberId && call.phoneNumberId !== VAPI_PHONE_NUMBER_ID) continue;

      // 3. User correlation check: strictly ensure call does not belong to another student
      if (userId && call.metadata?.userId && call.metadata.userId !== userId) {
        continue;
      }

      // 4. Request-specific idempotency correlation
      if (idempotencyKey && call.metadata?.idempotencyKey && call.metadata.idempotencyKey !== idempotencyKey) {
        continue;
      }

      // 5. Creation timestamp window check
      const callTime = call.createdAt ? new Date(call.createdAt).getTime() : now;
      if (callTime < initiatedAt - 5000 || callTime > now + 5000 || (now - callTime) > maxAgeMs) {
        continue;
      }

      matchingCalls.push({ id: call.id, status: call.status || "queued" });
    }

    // Ambiguity safety: Only associate if exactly ONE unambiguous matching call is found
    const firstMatch = matchingCalls[0];
    if (matchingCalls.length === 1 && firstMatch) {
      return firstMatch;
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Initiates an outbound AI phone call to a student.
 * Sanitizes phone numbers, validates configuration, and securely calls Vapi REST API.
 */
export const initiateOutboundCall = async (
  payload: OutboundCallRequest
): Promise<VapiCallResult> => {
  const { phoneNumber, userName, userEmail, preferredCourse, queryTopic } = payload;

  const VAPI_API_KEY = process.env.VAPI_API_KEY;
  const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
  const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

  if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID || !VAPI_ASSISTANT_ID) {
    console.error("[VAPI] Configuration missing in environment variables.");
    throw new VapiServiceError("Voice AI configuration is incomplete. Please contact support.", 503, false);
  }

  // Validate and format destination phone number to E.164
  const phoneValidation = formatAndValidatePhone(phoneNumber);
  if (!phoneValidation.isValid || !phoneValidation.e164) {
    throw new VapiServiceError(phoneValidation.error || "Valid international phone number is required.", 400, false);
  }

  const formattedPhone = phoneValidation.e164;
  const maskedDestination = maskPhoneNumber(formattedPhone);

  console.log(`[VAPI] Initiating outbound voice call to: ${maskedDestination}`);

  const initiationTimestamp = Date.now();

  try {
    const response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(CALL_INITIATION_TIMEOUT_MS),
      body: JSON.stringify({
        assistantId: VAPI_ASSISTANT_ID,
        phoneNumberId: VAPI_PHONE_NUMBER_ID,
        customer: {
          number: formattedPhone,
          name: userName,
        },
        metadata: {
          userId: payload.userId || "",
          idempotencyKey: payload.idempotencyKey || "",
        },
        assistantOverrides: {
          variableValues: {
            studentName: userName,
            studentEmail: userEmail || "Not provided",
            preferredCourse: preferredCourse || "Not specified",
            queryTopic: queryTopic || "General inquiry",
          },
        },
      }),
    });

    if (!response.ok) {
      let rawError = "";
      let parsedMessage: string | null = null;

      try {
        rawError = await response.text();
        const parsed = JSON.parse(rawError);
        if (Array.isArray(parsed?.message)) {
          parsedMessage = parsed.message.join("; ");
        } else if (typeof parsed?.message === "string") {
          parsedMessage = parsed.message;
        }
      } catch {
        // Fallback to raw error text
      }

      const sanitizedDetails = sanitizeLogMessage(parsedMessage || rawError);
      console.warn(`[VAPI] Call creation failed (HTTP ${response.status}) for ${maskedDestination}: ${sanitizedDetails}`);

      if (response.status === 400) {
        throw new VapiServiceError(sanitizedDetails || "Invalid call request or destination format.", 400, false);
      }
      if (response.status === 401) {
        throw new VapiServiceError("Voice AI service authorization failed.", 401, false);
      }
      if (response.status === 403) {
        throw new VapiServiceError("Outbound calling is restricted by the telephony provider or geographical permissions.", 403, false);
      }
      if (response.status === 404) {
        throw new VapiServiceError("Voice assistant or phone number resource was not found.", 404, false);
      }
      if (response.status === 429) {
        throw new VapiServiceError("Voice service rate limit or balance limit reached. Please try again later.", 429, false);
      }

      throw new VapiServiceError("Voice AI call service is temporarily unavailable.", response.status >= 500 ? 502 : response.status, false);
    }

    const data = (await response.json()) as { id: string; status?: string };
    console.log(`[VAPI] Call successfully created. Call ID: ${data.id}, Status: ${data.status || "queued"}`);

    return {
      id: data.id,
      status: data.status || "queued",
      maskedNumber: maskedDestination,
    };
  } catch (error) {
    if (error instanceof VapiServiceError) {
      throw error;
    }

    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        (error as any).code === "ETIMEDOUT" ||
        (error as any).code === "ECONNRESET");

    console.error(
      `[VAPI] Network/transport error during call initiation to ${maskedDestination}:`,
      error instanceof Error ? error.message : error
    );

    if (isTimeout) {
      // Ambiguous outcome: check whether Vapi actually accepted the call before timing out
      try {
        const recentCall = await findRecentCallForCustomer({
          phoneNumber: formattedPhone,
          userId: payload.userId,
          idempotencyKey: payload.idempotencyKey,
          initiatedAt: initiationTimestamp,
          maxAgeMs: 45000,
        });
        if (recentCall) {
          console.log(`[VAPI] Resolved ambiguous outcome: Call was created on Vapi with ID: ${recentCall.id}`);
          return {
            id: recentCall.id,
            status: recentCall.status,
            maskedNumber: maskedDestination,
          };
        }
      } catch (checkErr) {
        console.warn(
          "[VAPI] Unable to query recent calls to resolve timeout ambiguity:",
          checkErr instanceof Error ? checkErr.message : checkErr
        );
      }

      // If we cannot verify whether the call was created, do NOT allow immediate automatic retries.
      throw new VapiServiceError(
        "Voice provider request timed out. Please wait 15 seconds to check if your call was placed before retrying.",
        504,
        true // isAmbiguous: true
      );
    }

    throw new VapiServiceError("Unable to reach Voice AI provider. Please check network connection.", 503, false);
  }
};

/**
 * Retrieves real-time status of a call from Vapi.
 */
export const getVapiCallStatus = async (callId: string): Promise<VapiCallStatusResult> => {
  const VAPI_API_KEY = process.env.VAPI_API_KEY;
  if (!VAPI_API_KEY) {
    throw new VapiServiceError("Voice AI configuration missing.", 503);
  }

  if (!callId || typeof callId !== "string" || !/^[0-9a-zA-Z_-]{10,50}$/.test(callId)) {
    throw new VapiServiceError("Invalid call identifier.", 400);
  }

  try {
    const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
      },
      signal: AbortSignal.timeout(CALL_STATUS_TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new VapiServiceError("Call record not found.", 404);
      }
      throw new VapiServiceError("Failed to fetch call status from voice provider.", response.status);
    }

    const data = (await response.json()) as {
      id: string;
      status?: string;
      endedReason?: string;
      startedAt?: string;
      endedAt?: string;
    };

    const rawStatus = (data.status || "unknown").toLowerCase();
    const endedReason = data.endedReason || undefined;

    let displayStatus = "Call requested";
    let isFinished = false;

    if (rawStatus === "queued") {
      displayStatus = "Call queued for dialing...";
    } else if (rawStatus === "ringing") {
      displayStatus = "Dialing your phone... Please answer when it rings.";
    } else if (rawStatus === "in-progress") {
      displayStatus = "Connected! AI Counselor Ava is on the line.";
    } else if (rawStatus === "ended") {
      isFinished = true;
      if (endedReason === "customer-ended-call" || endedReason === "assistant-ended-call") {
        displayStatus = "Call completed successfully.";
      } else if (endedReason === "customer-did-not-answer") {
        displayStatus = "Call ended: Destination phone was not answered.";
      } else if (endedReason === "customer-busy") {
        displayStatus = "Call ended: Line was busy.";
      } else if (endedReason?.includes("insufficient-credits")) {
        displayStatus = "Call failed: Telephony provider insufficient credits.";
      } else if (endedReason?.includes("telephony") || endedReason?.includes("twilio")) {
        displayStatus = "Call failed: Telephony carrier rejected the outbound call.";
      } else {
        displayStatus = `Call ended (${endedReason || "completed"}).`;
      }
    }

    return {
      id: data.id,
      status: (rawStatus as any) || "unknown",
      endedReason,
      displayStatus,
      isFinished,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
    };
  } catch (error) {
    if (error instanceof VapiServiceError) {
      throw error;
    }
    console.error("[VAPI] Error fetching call status:", error instanceof Error ? error.message : error);
    throw new VapiServiceError("Unable to retrieve call status.", 500);
  }
};
