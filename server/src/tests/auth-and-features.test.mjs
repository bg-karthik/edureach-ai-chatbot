// ============================================
// FILE: src/tests/auth-and-features.test.mjs
// PURPOSE: Automated test suite for EduReach authentication, security & integrations
// ============================================

import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const mongoose = require("mongoose");

// 1. Configure isolated test database
const baseUri = process.env.MONGODB_URI;
if (!baseUri) {
  throw new Error("MONGODB_URI is not defined in environment variables");
}

// Ensure test URI uses edureach_test_db
const testDbUri = baseUri.replace(/\/edureach_db(\?|$)/, "/edureach_test_db$1");
process.env.MONGODB_URI = testDbUri;
process.env.PORT = "5002";
process.env.CLIENT_URL = "https://edureach-ai-chatbot-bgk.vercel.app,http://localhost:5173";

// Connect to MongoDB
await mongoose.connect(testDbUri);

// STRICT PRODUCTION SAFEGUARD
const currentDb = mongoose.connection.name;
console.log(`Connected to database: ${currentDb}`);
if (currentDb === "edureach_db" || currentDb !== "edureach_test_db") {
  console.error(`CRITICAL SAFETY ABORT: Connected to '${currentDb}' instead of 'edureach_test_db'!`);
  process.exit(1);
}

// Import models and application
const { default: User } = await import("../models/user.model.ts");
const { default: app } = await import("../app.ts");

// Clean existing synthetic test records before test run
await User.deleteMany({ email: /@synthetic-test-edureach\.com$/i });

// Start test HTTP server on port 5002
const TEST_PORT = 5002;
const server = app.listen(TEST_PORT, () => {
  console.log(`Test HTTP server listening on port ${TEST_PORT}`);
});

const BASE_URL = `http://localhost:${TEST_PORT}`;
const API_URL = `${BASE_URL}/api`;

const testResults = [];
let passCount = 0;
let failCount = 0;

function assert(testId, name, condition, details) {
  if (condition) {
    passCount++;
    testResults.push({ id: testId, name, passed: true, details });
    console.log(`✅ [PASS] #${testId} ${name} | Status: ${details?.status || "N/A"}`);
  } else {
    failCount++;
    testResults.push({ id: testId, name, passed: false, details });
    console.error(`❌ [FAIL] #${testId} ${name} | Details:`, details);
  }
}

try {
  console.log("\n==================== STARTING AUTOMATED TEST SUITE ====================\n");

  // TEST 1: Health Check (GET /)
  const rootHealthRes = await fetch(`${BASE_URL}/`);
  const rootHealthData = await rootHealthRes.json();
  assert(1, "Root Health Check (GET /)", rootHealthRes.status === 200 && rootHealthData.success === true, {
    status: rootHealthRes.status,
    body: rootHealthData,
  });

  // TEST 2: API Health Check (GET /api/health)
  const apiHealthRes = await fetch(`${API_URL}/health`);
  const apiHealthData = await apiHealthRes.json();
  assert(2, "API Health Check (GET /api/health)", apiHealthRes.status === 200 && apiHealthData.status === "healthy", {
    status: apiHealthRes.status,
    body: apiHealthData,
  });

  // TEST 3: Unknown Route Handling (GET /api/unknown-endpoint)
  const notFoundRes = await fetch(`${API_URL}/unknown-endpoint`);
  const notFoundData = await notFoundRes.json();
  assert(3, "Unknown Route Handling (404)", notFoundRes.status === 404 && notFoundData.success === false, {
    status: notFoundRes.status,
    body: notFoundData,
  });

  // TEST 4: Allowed CORS Preflight (OPTIONS from allowed origin)
  const corsAllowedRes = await fetch(`${API_URL}/auth/register`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://edureach-ai-chatbot-bgk.vercel.app",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  const allowOriginHeader = corsAllowedRes.headers.get("access-control-allow-origin");
  assert(4, "Allowed CORS Preflight (Vercel Origin)", corsAllowedRes.status === 204 && allowOriginHeader === "https://edureach-ai-chatbot-bgk.vercel.app", {
    status: corsAllowedRes.status,
    allowOrigin: allowOriginHeader,
    credentials: corsAllowedRes.headers.get("access-control-allow-credentials"),
  });

  // TEST 5: Allowed CORS Preflight (OPTIONS from local dev origin)
  const corsDevRes = await fetch(`${API_URL}/auth/register`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  const allowDevOriginHeader = corsDevRes.headers.get("access-control-allow-origin");
  assert(5, "Allowed CORS Preflight (Local Dev Origin)", corsDevRes.status === 204 && allowDevOriginHeader === "http://localhost:5173", {
    status: corsDevRes.status,
    allowOrigin: allowDevOriginHeader,
  });

  // TEST 6: Unauthorized CORS Origin Rejection
  const corsRejectRes = await fetch(`${API_URL}/auth/register`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://malicious-phishing-site.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  const rejectOriginHeader = corsRejectRes.headers.get("access-control-allow-origin");
  assert(6, "Unauthorized CORS Origin Rejection", rejectOriginHeader === null, {
    status: corsRejectRes.status,
    allowOrigin: rejectOriginHeader,
  });

  // TEST 7: Input Validation - Short Password
  const shortPassRes = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Short Pass User",
      email: `short_${Date.now()}@synthetic-test-edureach.com`,
      password: "123",
    }),
  });
  const shortPassData = await shortPassRes.json();
  assert(7, "Short Password Rejection (< 6 chars)", shortPassRes.status === 400 && shortPassData.success === false, {
    status: shortPassRes.status,
    message: shortPassData.message,
  });

  // TEST 8: Successful Student Registration
  const testEmail = `student_${Date.now()}@synthetic-test-edureach.com`;
  const testPassword = "ValidPassword123!";
  const regRes = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://edureach-ai-chatbot-bgk.vercel.app",
    },
    body: JSON.stringify({
      name: "  Sarah Connor  ",
      email: `  ${testEmail.toUpperCase()}  `, // Test case normalization & trimming
      password: testPassword,
      phone: "+91-9876543210",
    }),
  });
  const regData = await regRes.json();
  const token = regData.data?.token;
  const user = regData.data?.user;
  assert(
    8,
    "Successful Student Registration & Normalization",
    regRes.status === 201 &&
      regData.success === true &&
      !!token &&
      user?.name === "Sarah Connor" &&
      user?.email === testEmail.toLowerCase(),
    { status: regRes.status, user, hasToken: !!token }
  );

  // TEST 9: Duplicate Email Prevention
  const dupRes = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Sarah Duplicate",
      email: testEmail,
      password: "DifferentPassword123!",
    }),
  });
  const dupData = await dupRes.json();
  assert(9, "Duplicate Email Prevention (409 Conflict)", dupRes.status === 409 && dupData.success === false, {
    status: dupRes.status,
    message: dupData.message,
  });

  // TEST 10: Successful Login
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://edureach-ai-chatbot-bgk.vercel.app",
    },
    body: JSON.stringify({
      email: `  ${testEmail.toUpperCase()}  `,
      password: testPassword,
    }),
  });
  const loginData = await loginRes.json();
  const loginToken = loginData.data?.token;
  assert(10, "Successful Student Login", loginRes.status === 200 && !!loginToken, {
    status: loginRes.status,
    hasToken: !!loginToken,
    user: loginData.data?.user,
  });

  // TEST 11: Invalid Password Handling
  const wrongPassRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: testEmail,
      password: "IncorrectPassword456!",
    }),
  });
  const wrongPassData = await wrongPassRes.json();
  assert(11, "Invalid Password Handling (401)", wrongPassRes.status === 401 && wrongPassData.success === false, {
    status: wrongPassRes.status,
    message: wrongPassData.message,
  });

  // TEST 12: Nonexistent User Login
  const noUserRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "unknown_user_99999@synthetic-test-edureach.com",
      password: "SomePassword123!",
    }),
  });
  const noUserData = await noUserRes.json();
  assert(12, "Nonexistent User Login (401)", noUserRes.status === 401 && noUserData.message === "Invalid email or password.", {
    status: noUserRes.status,
    message: noUserData.message,
  });

  // TEST 13: Protected Route Access with Valid JWT (GET /api/auth/me)
  const meRes = await fetch(`${API_URL}/auth/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${loginToken}`,
      Origin: "https://edureach-ai-chatbot-bgk.vercel.app",
    },
  });
  const meData = await meRes.json();
  assert(13, "Protected Route Access with Valid JWT", meRes.status === 200 && meData.data?.user?.email === testEmail.toLowerCase(), {
    status: meRes.status,
    user: meData.data?.user,
  });

  // TEST 14: Protected Route Rejection - Missing JWT
  const noTokenRes = await fetch(`${API_URL}/auth/me`, { method: "GET" });
  const noTokenData = await noTokenRes.json();
  assert(14, "Protected Route Rejection - Missing Token (401)", noTokenRes.status === 401 && noTokenData.success === false, {
    status: noTokenRes.status,
    message: noTokenData.message,
  });

  // TEST 15: Protected Route Rejection - Invalid JWT
  const badTokenRes = await fetch(`${API_URL}/auth/me`, {
    method: "GET",
    headers: { Authorization: "Bearer this.is.a.forged.token" },
  });
  const badTokenData = await badTokenRes.json();
  assert(15, "Protected Route Rejection - Invalid Token (401)", badTokenRes.status === 401 && badTokenData.success === false, {
    status: badTokenRes.status,
    message: badTokenData.message,
  });

  // TEST 16: Vapi Voice Integration Validation (POST /api/vapi/call)
  const vapiInvalidRes = await fetch(`${API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginToken}`,
    },
    body: JSON.stringify({ phoneNumber: "123" }),
  });
  const vapiInvalidData = await vapiInvalidRes.json();
  assert(16, "Vapi Integration Validation (Short Phone Number Rejected)", vapiInvalidRes.status === 400 && vapiInvalidData.success === false, {
    status: vapiInvalidRes.status,
    message: vapiInvalidData.message,
  });

  // TEST 17: Vapi Call Status Route Authorization (Missing Token -> 401)
  const vapiNoAuthRes = await fetch(`${API_URL}/vapi/call/non-existent-call-id`);
  const vapiNoAuthData = await vapiNoAuthRes.json();
  assert(17, "Vapi Call Status Route Authorization (Missing Token -> 401)", vapiNoAuthRes.status === 401 && vapiNoAuthData.success === false, {
    status: vapiNoAuthRes.status,
    message: vapiNoAuthData.message,
  });

  // TEST 18: Vapi Call Status Ownership Authorization (Unowned/Non-existent Call -> 404)
  const vapiAuthUnownedRes = await fetch(`${API_URL}/vapi/call/mock-unowned-call-id`, {
    headers: { Authorization: `Bearer ${loginToken}` },
  });
  const vapiAuthUnownedData = await vapiAuthUnownedRes.json();
  assert(18, "Vapi Call Status IDOR Protection (Unowned Call -> 404)", vapiAuthUnownedRes.status === 404 && vapiAuthUnownedData.success === false, {
    status: vapiAuthUnownedRes.status,
    message: vapiAuthUnownedData.message,
  });

  // TEST 19: RAG AI Chatbot Integration Verification (POST /api/chat/message)
  console.log("\nTesting RAG Chatbot Integration (Retrieval + Gemini)...");
  const chatRes = await fetch(`${API_URL}/chat/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginToken}`,
    },
    body: JSON.stringify({ message: "What are the computer science programs?" }),
  });
  const chatData = await chatRes.json();
  const chatAnswer = chatData.data?.message;
  const isGenuineAnswer =
    chatRes.status === 200 &&
    chatData.success === true &&
    typeof chatAnswer === "string" &&
    chatAnswer.length > 20 &&
    !chatAnswer.includes("trouble right now") &&
    !chatAnswer.includes("maximum capacity") &&
    (chatAnswer.toLowerCase().includes("computer") ||
      chatAnswer.toLowerCase().includes("b.tech") ||
      chatAnswer.toLowerCase().includes("engineering") ||
      chatAnswer.toLowerCase().includes("edureach"));

  assert(
    19,
    "RAG AI Chatbot Response Verification (Genuine Knowledge Answer)",
    isGenuineAnswer,
    { status: chatRes.status, responseLength: chatAnswer?.length, sample: chatAnswer?.slice(0, 100) }
  );

  console.log("\n==================== TEST SUITE SUMMARY ====================");
  console.log(`Total Tests Run: ${testResults.length}`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);
  console.log("============================================================\n");

} finally {
  // Clean up synthetic test accounts
  const deleteResult = await User.deleteMany({ email: /@synthetic-test-edureach\.com$/i });
  console.log(`Cleaned up ${deleteResult.deletedCount} synthetic test record(s) from 'edureach_test_db'.`);
  await mongoose.disconnect();
  server.close();
  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}
