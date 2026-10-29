// ============================================
// FILE: src/tests/vapi-integration.test.mjs
// PURPOSE: Automated unit & integration tests for Vapi Voice AI (Mocked, Zero-Cost)
// ============================================

import { formatAndValidatePhone, maskPhoneNumber, sanitizeLogMessage } from "../utils/phone.util.ts";
import {
  initiateOutboundCall,
  getVapiCallStatus,
  VapiServiceError,
} from "../services/vapi.service.ts";

console.log("\n==================== STARTING VAPI UNIT & INTEGRATION TESTS ====================\n");

let passCount = 0;
let failCount = 0;

function assert(testId, name, condition, details) {
  if (condition) {
    passCount++;
    console.log(`✅ [PASS] #${testId} ${name}`);
  } else {
    failCount++;
    console.error(`❌ [FAIL] #${testId} ${name} | Details:`, details);
  }
}

// 1. Phone validation tests
console.log("--- 1. Phone Formatting & E.164 Validation Tests ---");

const res1 = formatAndValidatePhone("9876543210");
assert(1, "Indian 10-digit mobile auto-prefixes +91", res1.isValid && res1.e164 === "+919876543210", res1);

const res2 = formatAndValidatePhone("09876543210");
assert(2, "Indian 11-digit with leading 0 formats to +91", res2.isValid && res2.e164 === "+919876543210", res2);

const res3 = formatAndValidatePhone("+91 98765-43210");
assert(3, "Indian number with spaces and hyphens cleaned to E.164", res3.isValid && res3.e164 === "+919876543210", res3);

const res4 = formatAndValidatePhone("+1 (415) 555-2671");
assert(4, "International US number formatted to E.164", res4.isValid && res4.e164 === "+14155552671", res4);

const res5 = formatAndValidatePhone("+44 7911 123456");
assert(5, "International UK number formatted to E.164", res5.isValid && res5.e164 === "+447911123456", res5);

const res6 = formatAndValidatePhone("98765abcde");
assert(6, "Rejects numbers containing letters", !res6.isValid, res6);

const res7 = formatAndValidatePhone("123");
assert(7, "Rejects too-short number", !res7.isValid, res7);

const res8 = formatAndValidatePhone(null);
assert(8, "Safely handles null without throwing", !res8.isValid, res8);

const res9 = formatAndValidatePhone(undefined);
assert(9, "Safely handles undefined without throwing", !res9.isValid, res9);

const res10 = formatAndValidatePhone({ invalid: true });
assert(10, "Safely handles non-string object without throwing", !res10.isValid, res10);

// 2. Phone masking & redaction tests
console.log("\n--- 2. Phone Masking & Redaction Tests ---");

const masked1 = maskPhoneNumber("+919876543210");
assert(11, "Masks Indian phone number securely", masked1.startsWith("+919") && masked1.endsWith("210") && masked1.includes("****"), masked1);

const masked2 = maskPhoneNumber("+14155552671");
assert(12, "Masks US phone number securely", masked2.startsWith("+141") && masked2.endsWith("671") && masked2.includes("****"), masked2);

const masked3 = maskPhoneNumber("");
assert(13, "Handles empty phone masking safely", masked3 === "[REDACTED]", masked3);

const sanitizedLog1 = sanitizeLogMessage("Error calling +919876543210 with Bearer secret-token-xyz");
assert(14, "Sanitizes Bearer tokens and phone numbers in logs", sanitizedLog1.includes("[REDACTED]") && !sanitizedLog1.includes("secret-token-xyz") && !sanitizedLog1.includes("+919876543210"), sanitizedLog1);

const sanitizedLog2 = sanitizeLogMessage("Failed key=sk_live_1234567890abcdef for customer +14155552671");
assert(15, "Sanitizes API keys in provider error logs", sanitizedLog2.includes("[REDACTED]") && !sanitizedLog2.includes("sk_live_1234567890abcdef"), sanitizedLog2);

// 3. Mocked Vapi Service Tests
console.log("\n--- 3. Mocked Vapi API Responses & Error Handling ---");

const originalFetch = global.fetch;

// TEST 16: Mock 201 Created
global.fetch = async (url, opts) => {
  return {
    ok: true,
    status: 201,
    json: async () => ({
      id: "mock-call-12345",
      status: "queued",
      customer: { number: "+919876543210" },
    }),
  };
};

try {
  const result = await initiateOutboundCall({
    phoneNumber: "+919876543210",
    userName: "Test Student",
    userEmail: "test@example.com",
    preferredCourse: "B.Tech CSE",
  });
  assert(16, "Initiates call successfully on HTTP 201", result.id === "mock-call-12345" && result.status === "queued", result);
} catch (e) {
  assert(16, "Initiates call successfully on HTTP 201", false, e.message);
}

// TEST 17: Mock 401 Unauthorized API Key
global.fetch = async () => ({
  ok: false,
  status: 401,
  text: async () => JSON.stringify({ message: "Invalid API Key", statusCode: 401 }),
});

try {
  await initiateOutboundCall({
    phoneNumber: "+919876543210",
    userName: "Test Student",
  });
  assert(17, "Catches 401 Unauthorized", false, "Should have thrown");
} catch (e) {
  assert(17, "Catches 401 Unauthorized and returns sanitized error", e.statusCode === 401 && !e.message.includes("VAPI_API_KEY"), e.message);
}

// TEST 18: Mock 403 Forbidden (Telephony Geo-permission restriction)
global.fetch = async () => ({
  ok: false,
  status: 403,
  text: async () => JSON.stringify({ message: "Outbound call to country not permitted", statusCode: 403 }),
});

try {
  await initiateOutboundCall({
    phoneNumber: "+919876543210",
    userName: "Test Student",
  });
  assert(18, "Catches 403 Telephony provider restriction", false, "Should have thrown");
} catch (e) {
  assert(18, "Catches 403 Telephony provider restriction", e.statusCode === 403 && e.message.includes("restricted by the telephony provider"), e.message);
}

// TEST 19: Mock 404 Resource not found
global.fetch = async () => ({
  ok: false,
  status: 404,
  text: async () => JSON.stringify({ message: "Assistant not found", statusCode: 404 }),
});

try {
  await initiateOutboundCall({
    phoneNumber: "+919876543210",
    userName: "Test Student",
  });
  assert(19, "Catches 404 Not Found", false, "Should have thrown");
} catch (e) {
  assert(19, "Catches 404 Not Found", e.statusCode === 404, e.message);
}

// TEST 20: Mock 429 Insufficient credits / Rate limit
global.fetch = async () => ({
  ok: false,
  status: 429,
  text: async () => JSON.stringify({ message: "Credits balance exhausted", statusCode: 429 }),
});

try {
  await initiateOutboundCall({
    phoneNumber: "+919876543210",
    userName: "Test Student",
  });
  assert(20, "Catches 429 Rate limit / Credits exhausted", false, "Should have thrown");
} catch (e) {
  assert(20, "Catches 429 Rate limit / Credits exhausted", e.statusCode === 429 && e.message.includes("balance limit reached"), e.message);
}

// TEST 21: Mock Status Call - In-Progress
global.fetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => ({
    id: "mock-call-12345",
    status: "in-progress",
    startedAt: "2026-10-29T18:00:00Z",
  }),
});

const statusRes1 = await getVapiCallStatus("mock-call-12345");
assert(21, "Translates 'in-progress' status accurately", statusRes1.status === "in-progress" && statusRes1.displayStatus.includes("AI Counselor Ava is on the line"), statusRes1);

// TEST 22: Mock Status Call - Ended with customer-did-not-answer
global.fetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => ({
    id: "mock-call-12345",
    status: "ended",
    endedReason: "customer-did-not-answer",
    endedAt: "2026-10-29T18:01:00Z",
  }),
});

const statusRes2 = await getVapiCallStatus("mock-call-12345");
assert(22, "Translates 'ended' with 'customer-did-not-answer' accurately", statusRes2.status === "ended" && statusRes2.isFinished && statusRes2.displayStatus.includes("Destination phone was not answered"), statusRes2);

// TEST 23: Mock Status Call - Ended with telephony carrier failure
global.fetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => ({
    id: "mock-call-12345",
    status: "ended",
    endedReason: "twilio-failed-to-connect",
    endedAt: "2026-10-29T18:01:00Z",
  }),
});

const statusRes3 = await getVapiCallStatus("mock-call-12345");
assert(23, "Translates 'ended' with telephony carrier rejection", statusRes3.status === "ended" && statusRes3.isFinished && statusRes3.displayStatus.includes("Telephony carrier rejected"), statusRes3);

// Restore original fetch
global.fetch = originalFetch;

console.log("\n==================== VAPI TEST SUMMARY ====================");
console.log(`Total Vapi Tests: ${passCount + failCount}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);
console.log("===========================================================\n");

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

