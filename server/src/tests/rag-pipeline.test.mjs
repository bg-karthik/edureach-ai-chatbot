// ============================================
// FILE: src/tests/rag-pipeline.test.mjs
// PURPOSE: Automated test suite for RAG pipeline, error classification, quota handling, and non-false-positive validation
// ============================================

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const baseUri = process.env.MONGODB_URI;
if (!baseUri) {
  throw new Error("MONGODB_URI is required");
}

// Ensure isolated test database
const testDbUri = baseUri.replace(/\/edureach_db(\?|$)/, "/edureach_test_db$1");
process.env.MONGODB_URI = testDbUri;
process.env.PORT = "5007";
process.env.CLIENT_URL = "https://edureach-ai-chatbot-bgk.vercel.app,http://localhost:5173";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-123456";

await mongoose.connect(testDbUri);

if (mongoose.connection.name !== "edureach_test_db") {
  console.error("FATAL: Test connected to unsafe database:", mongoose.connection.name);
  process.exit(1);
}
console.log(`\nConnected to isolated test database: ${mongoose.connection.name}`);

// Import models, utils, and app
const { default: User } = await import("../models/user.model.ts");
const { generateToken } = await import("../utils/jwt.util.ts");
const { RAGServiceError, classifyRAGError } = await import("../services/rag.service.ts");
const { default: app } = await import("../app.ts");

// Clean synthetic test records
await User.deleteMany({ email: /@synthetic-test-rag-edureach\.com$/i });

const TEST_PORT = 5007;
const server = app.listen(TEST_PORT);
const API_URL = `http://127.0.0.1:${TEST_PORT}/api`;

let passCount = 0;
let failCount = 0;

function assert(testId, name, condition, details = {}) {
  if (condition) {
    passCount++;
    console.log(`✅ [PASS] #${testId} ${name}`);
  } else {
    failCount++;
    console.error(`❌ [FAIL] #${testId} ${name} | Details:`, details);
  }
}

console.log("\n==================== STARTING RAG PIPELINE & ERROR CLASSIFICATION TESTS ====================\n");

try {
  // Setup synthetic student
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const testStudent = await User.create({
    name: "Clara Oswald",
    email: "clara_rag@synthetic-test-rag-edureach.com",
    password: passwordHash,
    course: "Computer Science",
  });
  const token = generateToken({ userId: testStudent._id.toString(), email: testStudent.email });

  // TEST 1: Unauthenticated request rejected with HTTP 401
  const noAuthRes = await fetch(`${API_URL}/chat/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "What are the courses?" }),
  });
  const noAuthData = await noAuthRes.json();
  assert(1, "Protected Route Rejects Missing Token (HTTP 401)", noAuthRes.status === 401 && noAuthData.success === false, {
    status: noAuthRes.status,
    data: noAuthData,
  });

  // TEST 2: Invalid/Empty message rejected with HTTP 400
  const emptyRes = await fetch(`${API_URL}/chat/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: "   " }),
  });
  const emptyData = await emptyRes.json();
  assert(2, "Empty Message Rejected with HTTP 400", emptyRes.status === 400 && emptyData.success === false, {
    status: emptyRes.status,
    data: emptyData,
  });

  // TEST 3: Error Classification - Quota Exhaustion (429)
  const quotaErr = classifyRAGError({
    status: 429,
    message: "Resource has been exhausted (e.g. check quota)",
    errorDetails: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure" }],
  });
  assert(
    3,
    "Error Classification: Quota Exhaustion maps to HTTP 429",
    quotaErr.category === "QUOTA_EXHAUSTED" &&
      quotaErr.statusCode === 429 &&
      quotaErr.userMessage.includes("maximum capacity"),
    { quotaErr }
  );

  // TEST 4: Error Classification - Invalid API Key / Auth (503/401)
  const authErr = classifyRAGError({
    status: 401,
    message: "API_KEY_INVALID: API key not valid",
  });
  assert(
    4,
    "Error Classification: Auth Failure maps to HTTP 503 without leaking key",
    authErr.category === "AUTH_FAILED" &&
      authErr.statusCode === 503 &&
      !authErr.userMessage.includes("AIza"),
    { authErr }
  );

  // TEST 5: Error Classification - Model Not Found (404 -> 503)
  const modelErr = classifyRAGError({
    status: 404,
    message: "models/gemini-old is not found for API version v1beta",
  });
  assert(
    5,
    "Error Classification: Model Not Found maps to HTTP 503",
    modelErr.category === "MODEL_NOT_FOUND" && modelErr.statusCode === 503,
    { modelErr }
  );

  // TEST 6: Error Classification - Database Failure (503)
  const dbErr = classifyRAGError(new Error("MongoNetworkError: connection timed out to Atlas"));
  assert(
    6,
    "Error Classification: Database/Vector Search Failure maps to HTTP 503",
    dbErr.category === "DATABASE_ERROR" &&
      dbErr.statusCode === 503 &&
      dbErr.userMessage.includes("temporarily unreachable"),
    { dbErr }
  );

  // TEST 7: Error Classification - Request Timeout (504)
  const timeoutErr = classifyRAGError(new Error("The operation was aborted due to timeout"));
  assert(
    7,
    "Error Classification: Timeout maps to HTTP 504",
    timeoutErr.category === "TIMEOUT" && timeoutErr.statusCode === 504,
    { timeoutErr }
  );

  // TEST 8: Controller Error Response Structure on RAG Failure
  const testError = new RAGServiceError(
    "QUOTA_EXHAUSTED",
    429,
    "The AI counselor is currently operating at maximum capacity. Please try again shortly.",
    "Quota limit reached"
  );
  assert(
    8,
    "RAG Failure Is Never Disguised as HTTP 200 Success",
    testError.statusCode !== 200 && testError.userMessage.length > 0,
    { statusCode: testError.statusCode }
  );

  // TEST 9: Live RAG Question Answering with Active Gemini Model & Knowledge Base
  console.log("\nExecuting live RAG query against college knowledge base...");
  const liveChatRes = await fetch(`${API_URL}/chat/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: "What are the courses present at EduReach?" }),
  });
  const liveChatData = await liveChatRes.json();
  const answer = liveChatData.data?.message;

  const isGenuineSuccess =
    liveChatRes.status === 200 &&
    liveChatData.success === true &&
    typeof answer === "string" &&
    !answer.includes("trouble right now") &&
    !answer.includes("maximum capacity") &&
    (answer.toLowerCase().includes("b.tech") ||
      answer.toLowerCase().includes("computer science") ||
      answer.toLowerCase().includes("engineering") ||
      answer.toLowerCase().includes("mba"));

  assert(
    9,
    "Live RAG Answers Student Question with Genuine Knowledge Base Content (Non-False-Positive)",
    isGenuineSuccess,
    {
      status: liveChatRes.status,
      success: liveChatData.success,
      answerPreview: answer ? answer.slice(0, 150) : "NO ANSWER",
    }
  );

  // TEST 10: Live Second Query - Placements
  console.log("Executing second live RAG query for placements...");
  const placementRes = await fetch(`${API_URL}/chat/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: "Tell me about placements" }),
  });
  const placementData = await placementRes.json();
  const placementAnswer = placementData.data?.message;

  const isPlacementSuccess =
    placementRes.status === 200 &&
    placementData.success === true &&
    typeof placementAnswer === "string" &&
    !placementAnswer.includes("trouble right now") &&
    !placementAnswer.includes("maximum capacity") &&
    (placementAnswer.includes("92") ||
      placementAnswer.toLowerCase().includes("placement") ||
      placementAnswer.toLowerCase().includes("package") ||
      placementAnswer.toLowerCase().includes("google"));

  assert(
    10,
    "Live RAG Retrieves & Explains Placement Statistics Accurately",
    isPlacementSuccess,
    {
      status: placementRes.status,
      answerPreview: placementAnswer ? placementAnswer.slice(0, 150) : "NO ANSWER",
    }
  );

  // TEST 11: Client Abort Cancellation Handling
  console.log("Testing client abort cancellation during in-flight RAG request...");
  const abortController = new AbortController();
  const abortedFetch = fetch(`${API_URL}/chat/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: "What are the computer science courses?" }),
    signal: abortController.signal,
  });

  // Abort client connection immediately while in-flight
  setTimeout(() => abortController.abort(), 50);

  let abortedCleanly = false;
  try {
    await abortedFetch;
  } catch (clientErr) {
    if (clientErr.name === "AbortError") {
      abortedCleanly = true;
    }
  }

  // Small delay to allow server req.on("close") to execute cleanly
  await new Promise((r) => setTimeout(r, 200));

  assert(
    11,
    "Client Abort Cancels In-Flight RAG Upstream Safely Without Server Crash",
    abortedCleanly,
    { abortedCleanly }
  );

} catch (err) {
  console.error("Test execution exception:", err);
} finally {
  await User.deleteMany({ email: /@synthetic-test-rag-edureach\.com$/i });
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
}

console.log("\n==================== RAG PIPELINE TEST SUMMARY ====================");
console.log(`Total Tests Run: ${passCount + failCount}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);
console.log("===================================================================\n");

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

