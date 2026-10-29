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

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = "VapiServiceError";
    this.statusCode = statusCode;
  }
}

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
    throw new VapiServiceError("Voice AI configuration is incomplete. Please contact support.", 503);
  }

  // Validate and format destination phone number to E.164
  const phoneValidation = formatAndValidatePhone(phoneNumber);
  if (!phoneValidation.isValid || !phoneValidation.e164) {
    throw new VapiServiceError(phoneValidation.error || "Valid international phone number is required.", 400);
  }

  const formattedPhone = phoneValidation.e164;
  const maskedDestination = maskPhoneNumber(formattedPhone);

  console.log(`[VAPI] Initiating outbound voice call to: ${maskedDestination}`);

  try {
    const response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId: VAPI_ASSISTANT_ID,
        phoneNumberId: VAPI_PHONE_NUMBER_ID,
        customer: {
          number: formattedPhone,
          name: userName,
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
        throw new VapiServiceError(sanitizedDetails || "Invalid call request or destination format.", 400);
      }
      if (response.status === 401) {
        throw new VapiServiceError("Voice AI service authorization failed.", 401);
      }
      if (response.status === 403) {
        throw new VapiServiceError("Outbound calling is restricted by the telephony provider or geographical permissions.", 403);
      }
      if (response.status === 404) {
        throw new VapiServiceError("Voice assistant or phone number resource was not found.", 404);
      }
      if (response.status === 429) {
        throw new VapiServiceError("Voice service rate limit or balance limit reached. Please try again later.", 429);
      }

      throw new VapiServiceError("Voice AI call service is temporarily unavailable.", response.status >= 500 ? 502 : response.status);
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
    console.error("[VAPI] Network error while contacting Vapi API:", error instanceof Error ? error.message : error);
    throw new VapiServiceError("Unable to reach Voice AI provider. Please check network connection.", 503);
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
