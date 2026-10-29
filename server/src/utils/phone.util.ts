// ============================================
// FILE: src/utils/phone.util.ts
// PURPOSE: E.164 phone number formatting, validation, and redaction
// ============================================

export interface PhoneValidationResult {
  isValid: boolean;
  e164?: string;
  error?: string;
}

/**
 * Validates and formats a phone number into strict E.164 format (+[country_code][number]).
 * Supports:
 * - Direct E.164 inputs (e.g. +919876543210, +14155552671)
 * - Indian 10-digit mobile numbers (6-9xxxxxxxxx -> +91xxxxxxxxxx)
 * - Indian 11-digit mobile numbers with leading 0 (09876543210 -> +919876543210)
 * - Strips common formatting characters (spaces, dashes, parentheses, dots)
 * - Rejects malformed values and non-string inputs safely
 */
export function formatAndValidatePhone(input: unknown): PhoneValidationResult {
  if (typeof input !== "string") {
    return { isValid: false, error: "Phone number must be a text string." };
  }

  const raw = input.trim();
  if (!raw) {
    return { isValid: false, error: "Phone number is required." };
  }

  // Remove common punctuation: spaces, hyphens, parentheses, dots
  const cleaned = raw.replace(/[\s\-\(\)\.]/g, "");

  // Reject strings containing letters or disallowed symbols
  if (/[^0-9+]/.test(cleaned)) {
    return { isValid: false, error: "Phone number contains invalid characters." };
  }

  let normalized = cleaned;

  if (!normalized.startsWith("+")) {
    // 10-digit Indian mobile number (begins with 6, 7, 8, or 9)
    if (/^[6-9]\d{9}$/.test(normalized)) {
      normalized = `+91${normalized}`;
    }
    // 11-digit Indian number starting with 0
    else if (/^0[6-9]\d{9}$/.test(normalized)) {
      normalized = `+91${normalized.slice(1)}`;
    }
    // 12-digit Indian number starting with 91
    else if (/^91[6-9]\d{9}$/.test(normalized)) {
      normalized = `+${normalized}`;
    }
    // 10-digit international number without + (prompt for country code)
    else {
      return {
        isValid: false,
        error: "Please include your international country code starting with '+' (e.g. +91 for India).",
      };
    }
  }

  // Strict E.164 validation: + followed by 8 to 15 digits (no 0 directly after +)
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  if (!e164Regex.test(normalized)) {
    return {
      isValid: false,
      error: "Phone number must be a valid E.164 international format (e.g., +919876543210).",
    };
  }

  return {
    isValid: true,
    e164: normalized,
  };
}

/**
 * Masks a phone number for secure logging and diagnostics.
 * Example: +919876543210 -> +9198****3210
 */
export function maskPhoneNumber(phone?: string): string {
  if (!phone || typeof phone !== "string") return "[REDACTED]";
  const trimmed = phone.trim();
  if (trimmed.length <= 6) return "***";
  const start = trimmed.slice(0, 4);
  const end = trimmed.slice(-3);
  return `${start}${"*".repeat(Math.max(trimmed.length - 7, 4))}${end}`;
}

/**
 * Sanitizes arbitrary log messages or provider errors by masking telephone numbers
 * and redacting Bearer tokens/API keys.
 */
export function sanitizeLogMessage(message: unknown): string {
  if (!message || typeof message !== "string") return "";
  let sanitized = message;
  // Redact Bearer tokens and authorization headers
  sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, "$1[REDACTED]");
  sanitized = sanitized.replace(/(key[=:\s]+)[A-Za-z0-9_\-\.]{8,}/gi, "$1[REDACTED]");
  // Redact phone numbers (with or without international prefix)
  sanitized = sanitized.replace(/(\+?[1-9]\d{9,14})/g, (match) => maskPhoneNumber(match));
  return sanitized;
}

