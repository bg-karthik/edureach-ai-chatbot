// ============================================
// FILE: src/tests/persistent-call-tracking.test.mjs
// PURPOSE: Verify persistent MongoDB call tracking, atomic concurrency lock, IDOR isolation & restart recovery
// ============================================

import { createRequire } from "module";
import http from "http";

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
process.env.PORT = "5003";
process.env.CLIENT_URL = "https://edureach-ai-chatbot-bgk.vercel.app,http://localhost:5173";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-123456";

await mongoose.connect(testDbUri);

// Safeguard check
if (mongoose.connection.name !== "edureach_test_db") {
  console.error("FATAL: Test connected to unsafe database:", mongoose.connection.name);
  process.exit(1);
}
console.log(`\nConnected to isolated test database: ${mongoose.connection.name}`);

// Import models and app
const { default: User } = await import("../models/user.model.ts");
const { default: CallRecord } = await import("../models/call.model.ts");
const { generateToken } = await import("../utils/jwt.util.ts");
const { default: app } = await import("../app.ts");

// Clean synthetic test records
await User.deleteMany({ email: /@synthetic-test-call-edureach\.com$/i });
await CallRecord.deleteMany({ destination: { $regex: /^\+919/ } });

// Ensure MongoDB indexes are synced before testing
await CallRecord.syncIndexes();

// Start test server on port 5003
const TEST_PORT = 5003;
let server = app.listen(TEST_PORT);
const API_URL = `http://localhost:${TEST_PORT}/api`;

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

console.log("\n==================== STARTING PERSISTENT CALL TRACKING TESTS ====================\n");

let mockCallCounter = Date.now();
let mockVapiShouldFail = false;
let mockVapiTimeout = false;
let mockVapiCreditsExhausted = false;
let mockVapiRecentCalls = [];

// Mock global.fetch to intercept Vapi REST calls (preventing real phone calls)
const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const urlStr = String(url);

  // Allow local test server requests to pass through
  if (urlStr.startsWith("http://localhost:") || urlStr.startsWith("http://127.0.0.1:")) {
    return originalFetch(url, options);
  }

  // Intercept Vapi Recent Calls query (for timeout ambiguity resolution)
  if (urlStr.includes("api.vapi.ai/call?") && (!options.method || options.method === "GET")) {
    return {
      ok: true,
      status: 200,
      json: async () => mockVapiRecentCalls,
    };
  }

  // Intercept Vapi Call Initiation
  if (urlStr.includes("api.vapi.ai/call") && options.method === "POST") {
    if (mockVapiTimeout) {
      const timeoutErr = new Error("The operation was aborted due to timeout");
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    }

    if (mockVapiCreditsExhausted) {
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ message: "Credits balance exhausted", statusCode: 429 }),
      };
    }

    if (mockVapiShouldFail) {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: "Mock provider outage" }),
      };
    }

    mockCallCounter++;
    const assignedId = `mock-vapi-call-${mockCallCounter}`;
    return {
      ok: true,
      status: 201,
      json: async () => ({
        id: assignedId,
        status: "queued",
        customer: { number: "+919876543210" },
      }),
    };
  }

  // Intercept Vapi Call Status Lookup
  if (urlStr.includes("api.vapi.ai/call/") && (!options.method || options.method === "GET")) {
    const parts = urlStr.split("/");
    const id = parts[parts.length - 1];

    if (id === "non-existent-call") {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: "Call not found" }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        id,
        status: "in-progress",
        startedAt: new Date().toISOString(),
      }),
    };
  }

  // Pass through other requests
  return originalFetch(url, options);
};

try {
  // 1. Create two test students (Student A and Student B)
  const passwordHash = await bcrypt.hash("Password123!", 10);

  const studentA = await User.create({
    name: "Student Alpha",
    email: "student-a@synthetic-test-call-edureach.com",
    password: passwordHash,
  });

  const studentB = await User.create({
    name: "Student Beta",
    email: "student-b@synthetic-test-call-edureach.com",
    password: passwordHash,
  });

  const tokenA = generateToken({ userId: studentA._id.toString(), email: studentA.email });
  const tokenB = generateToken({ userId: studentB._id.toString(), email: studentB.email });

  // TEST 1: MongoDB TTL Index Verification on CallRecord
  const indexes = await CallRecord.collection.indexes();
  const ttlIndex = indexes.find(
    (idx) => idx.expireAfterSeconds !== undefined && idx.key?.createdAt !== undefined
  );
  assert(
    1,
    "MongoDB TTL Index on CallRecord.createdAt (30-day retention)",
    ttlIndex !== undefined && ttlIndex.expireAfterSeconds === 30 * 24 * 60 * 60,
    { ttlIndex }
  );

  // TEST 2: Successful Call Initiation & MongoDB Persistence
  const idempKeyA = `idemp-studentA-${Date.now()}`;
  const initRes = await fetch(`${API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      phoneNumber: "+919876543210",
      preferredCourse: "B.Tech Computer Science",
      queryTopic: "Admissions & Eligibility",
      idempotencyKey: idempKeyA,
    }),
  });
  const initData = await initRes.json();
  const callIdA = initData.data?.callId;

  const persistedRecordA = await CallRecord.findOne({ callId: callIdA });

  assert(
    2,
    "Persistent Call Record Created in MongoDB",
    initRes.status === 200 &&
      initData.success === true &&
      typeof callIdA === "string" &&
      persistedRecordA !== null &&
      persistedRecordA.userId.toString() === studentA._id.toString() &&
      persistedRecordA.destination.startsWith("+919") &&
      persistedRecordA.destination.includes("****") &&
      persistedRecordA.status === "queued",
    { initStatus: initRes.status, callId: callIdA, record: persistedRecordA }
  );

  // TEST 3: Idempotency Key Deduplication (Replay same request)
  const replayRes = await fetch(`${API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      phoneNumber: "+919876543210",
      preferredCourse: "B.Tech Computer Science",
      queryTopic: "Admissions & Eligibility",
      idempotencyKey: idempKeyA,
    }),
  });
  const replayData = await replayRes.json();
  assert(
    3,
    "Idempotency Key Deduplication (Returns existing call without re-dialing)",
    replayRes.status === 200 &&
      replayData.data?.callId === callIdA &&
      replayData.message.includes("already initiated"),
    { replayStatus: replayRes.status, replayData }
  );

  // TEST 4: Atomic Cooldown & Concurrent Duplicate Request Protection
  // Simulate 5 simultaneous requests from Student A with different idempotency keys
  console.log("\nSimulating 5 simultaneous concurrent requests from Student A...");
  const concurrentPromises = Array.from({ length: 5 }, (_, i) =>
    fetch(`${API_URL}/vapi/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        phoneNumber: "+919876543210",
        preferredCourse: "B.Tech CSE",
        queryTopic: "Campus Housing",
        idempotencyKey: `concurrent-burst-${Date.now()}-${i}`,
      }),
    }).then(async (r) => ({ status: r.status, data: await r.json() }))
  );

  const concurrentResults = await Promise.all(concurrentPromises);
  const successCount = concurrentResults.filter((r) => r.status === 200).length;
  const rateLimitedCount = concurrentResults.filter((r) => r.status === 429).length;

  assert(
    4,
    "Atomic Concurrency Protection (All duplicate concurrent bursts blocked with HTTP 429)",
    successCount === 0 && rateLimitedCount === 5,
    { successCount, rateLimitedCount, sampleError: concurrentResults[0]?.data?.message }
  );

  // TEST 5: Server Restart Recovery & MongoDB State Persistence
  // We shut down the existing HTTP server instance and start a new server instance to simulate a restart
  console.log("\nSimulating complete server process restart...");
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));

  // Start fresh server instance on port 5004
  const TEST_PORT_2 = 5004;
  let server2 = app.listen(TEST_PORT_2);
  const RESTART_API_URL = `http://localhost:${TEST_PORT_2}/api`;

  // Student A retrieves status of their previously saved call from the restarted server
  const statusAfterRestartRes = await fetch(`${RESTART_API_URL}/vapi/call/${callIdA}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const statusAfterRestartData = await statusAfterRestartRes.json();

  assert(
    5,
    "Server Restart Recovery (Call record retrieved from MongoDB after restart)",
    statusAfterRestartRes.status === 200 &&
      statusAfterRestartData.success === true &&
      statusAfterRestartData.data?.id === callIdA &&
      statusAfterRestartData.data?.status === "in-progress",
    { status: statusAfterRestartRes.status, data: statusAfterRestartData }
  );

  // TEST 6: Cross-User Isolation (IDOR Protection)
  // Student B attempts to query Student A's callId
  const idorRes = await fetch(`${RESTART_API_URL}/vapi/call/${callIdA}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  const idorData = await idorRes.json();

  assert(
    6,
    "Cross-User Isolation (Student B rejected with HTTP 403 when querying Student A's call)",
    idorRes.status === 403 &&
      idorData.success === false &&
      idorData.message.includes("do not have permission"),
    { idorStatus: idorRes.status, message: idorData.message }
  );

  // TEST 7: Nonexistent Call ID Lookup
  const notFoundRes = await fetch(`${RESTART_API_URL}/vapi/call/non-existent-call-12345`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const notFoundData = await notFoundRes.json();

  assert(
    7,
    "Nonexistent Call Record Lookup (Returns HTTP 404)",
    notFoundRes.status === 404 && notFoundData.success === false,
    { notFoundStatus: notFoundRes.status, message: notFoundData.message }
  );

  // TEST 8: Safe Error Handling & Lock Release on Provider Failure
  console.log("\nTesting failure handling and automatic atomic lock release...");
  // Clear Student B's lock first
  await User.findByIdAndUpdate(studentB._id, { $set: { callLockUntil: null } });

  // Enable simulated mock provider failure
  mockVapiShouldFail = true;

  const failRes = await fetch(`${RESTART_API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({
      phoneNumber: "+919876543210",
      preferredCourse: "MBA",
      queryTopic: "Fee Structure",
      idempotencyKey: "failing-request-001",
    }),
  });

  const failData = await failRes.json();

  // Verify the lock was automatically released on student B
  const studentBAfterFail = await User.findById(studentB._id);
  const isLockReleased = !studentBAfterFail.callLockUntil;

  assert(
    8,
    "Lock Automatically Released on Provider Error (Student can retry immediately)",
    failRes.status >= 500 && isLockReleased === true,
    { failStatus: failRes.status, failMessage: failData.message, isLockReleased }
  );

  // Reset mock flag
  mockVapiShouldFail = false;

  // TEST 9: Ambiguous Timeout Recovery (Call confirmed created on Vapi despite client timeout)
  console.log("\nTesting ambiguous provider timeout recovery...");
  await User.findByIdAndUpdate(studentB._id, { $set: { callLockUntil: null } });

  // Simulate timeout during POST /call, but call WAS created on Vapi
  const timeoutRecoverKey = `timeout-recover-${Date.now()}`;
  mockVapiTimeout = true;
  mockVapiRecentCalls = [
    {
      id: "mock-recovered-vapi-call-999",
      assistantId: process.env.VAPI_ASSISTANT_ID,
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      status: "queued",
      customer: { number: "+919876543210" },
      metadata: {
        userId: studentB._id.toString(),
        idempotencyKey: timeoutRecoverKey,
      },
      createdAt: new Date().toISOString(),
    },
  ];

  const timeoutRecoverRes = await fetch(`${RESTART_API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({
      phoneNumber: "+919876543210",
      preferredCourse: "B.Tech AI",
      queryTopic: "Curriculum",
      idempotencyKey: timeoutRecoverKey,
    }),
  });

  const timeoutRecoverData = await timeoutRecoverRes.json();
  const recoveredCall = await CallRecord.findOne({ callId: "mock-recovered-vapi-call-999" });

  assert(
    9,
    "Ambiguous Timeout Recovery (Recovers call created on Vapi without placing duplicate)",
    timeoutRecoverRes.status === 200 &&
      timeoutRecoverData.success === true &&
      timeoutRecoverData.data?.callId === "mock-recovered-vapi-call-999" &&
      recoveredCall !== null &&
      recoveredCall.userId.toString() === studentB._id.toString(),
    { timeoutRecoverRes: timeoutRecoverRes.status, timeoutRecoverData, recoveredCall }
  );

  mockVapiTimeout = false;
  mockVapiRecentCalls = [];

  // TEST 10: Ambiguous Timeout Unverified (Call could not be verified on Vapi -> Lock retained)
  console.log("\nTesting ambiguous timeout where provider outcome cannot be verified...");
  await User.findByIdAndUpdate(studentB._id, { $set: { callLockUntil: null } });

  mockVapiTimeout = true;
  mockVapiRecentCalls = []; // No matching recent calls found

  const unverifiedTimeoutRes = await fetch(`${RESTART_API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({
      phoneNumber: "+919876543210",
      preferredCourse: "B.Tech AI",
      queryTopic: "Curriculum",
      idempotencyKey: `timeout-unverified-${Date.now()}`,
    }),
  });

  const unverifiedTimeoutData = await unverifiedTimeoutRes.json();
  const studentBAfterUnverified = await User.findById(studentB._id);
  const isLockPreserved = studentBAfterUnverified.callLockUntil !== null;

  assert(
    10,
    "Ambiguous Timeout Lock Preservation (Lock retained to strictly prevent duplicate paid call)",
    unverifiedTimeoutRes.status === 504 && isLockPreserved === true,
    { unverifiedStatus: unverifiedTimeoutRes.status, message: unverifiedTimeoutData.message, isLockPreserved }
  );

  mockVapiTimeout = false;

  // TEST 11: Insufficient Credits Error Handling (HTTP 429 balance limit)
  console.log("\nTesting insufficient credits / zero-credit provider response handling...");
  await User.findByIdAndUpdate(studentA._id, { $set: { callLockUntil: null } });

  mockVapiCreditsExhausted = true;

  const creditRes = await fetch(`${RESTART_API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      phoneNumber: "+919876543210",
      preferredCourse: "CSE",
      queryTopic: "Scholarship",
      idempotencyKey: `credits-test-${Date.now()}`,
    }),
  });

  const creditData = await creditRes.json();
  const studentAAfterCreditFail = await User.findById(studentA._id);
  const isCreditLockReleased = !studentAAfterCreditFail.callLockUntil;

  assert(
    11,
    "Insufficient Credits Handling (HTTP 429 with sanitized error, lock released)",
    creditRes.status === 429 &&
      creditData.message.includes("balance limit reached") &&
      isCreditLockReleased === true,
    { status: creditRes.status, message: creditData.message, isCreditLockReleased }
  );

  mockVapiCreditsExhausted = false;

  // TEST 12: Idempotency Key Reuse with Different Request Payload (HTTP 409 Conflict)
  console.log("\nTesting idempotency key reuse with mismatched payload...");
  const mismatchPayloadRes = await fetch(`${RESTART_API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      phoneNumber: "+919876543210",
      preferredCourse: "M.Tech Data Science (Altered Course)",
      queryTopic: "Admissions & Eligibility",
      idempotencyKey: idempKeyA,
    }),
  });

  const mismatchPayloadData = await mismatchPayloadRes.json();
  assert(
    12,
    "Idempotency Key Payload Consistency (Rejects reuse with different parameters -> 409)",
    mismatchPayloadRes.status === 409 &&
      mismatchPayloadData.message.includes("different request payload"),
    { status: mismatchPayloadRes.status, message: mismatchPayloadData.message }
  );

  // TEST 13: Cross-Student Call Recovery Protection (Does NOT associate another student's call on timeout)
  console.log("\nTesting cross-student call recovery isolation during ambiguous timeout...");
  await User.findByIdAndUpdate(studentB._id, { $set: { callLockUntil: null } });

  const studentBTimeoutKey = `timeout-b-${Date.now()}`;
  mockVapiTimeout = true;
  mockVapiRecentCalls = [
    {
      id: "mock-foreign-student-call-777",
      assistantId: process.env.VAPI_ASSISTANT_ID,
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      status: "queued",
      customer: { number: "+919876543210" },
      metadata: {
        userId: studentA._id.toString(), // Belongs to Student A, NOT Student B!
        idempotencyKey: "foreign-key-123",
      },
      createdAt: new Date().toISOString(),
    },
  ];

  const crossStudentRecoverRes = await fetch(`${RESTART_API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({
      phoneNumber: "+919876543210",
      preferredCourse: "B.Tech AI",
      queryTopic: "Curriculum",
      idempotencyKey: studentBTimeoutKey,
    }),
  });

  const crossStudentRecoverData = await crossStudentRecoverRes.json();
  const foreignCallInDb = await CallRecord.findOne({ callId: "mock-foreign-student-call-777" });

  assert(
    13,
    "Cross-Student Call Isolation During Timeout (Refuses to associate foreign student call)",
    crossStudentRecoverRes.status === 504 && foreignCallInDb === null,
    { status: crossStudentRecoverRes.status, message: crossStudentRecoverData.message, foreignCallInDb }
  );

  mockVapiTimeout = false;
  mockVapiRecentCalls = [];

  // TEST 14: Safe Lock Expiry Recovery (Lock is automatically usable once expired without manual intervention)
  console.log("\nTesting automatic recovery from expired call locks...");
  // Simulate an expired lock left behind from an earlier request 30 seconds ago
  await User.findByIdAndUpdate(studentA._id, { $set: { callLockUntil: new Date(Date.now() - 30000) } });

  const expiredLockRes = await fetch(`${RESTART_API_URL}/vapi/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenA}`,
    },
    body: JSON.stringify({
      phoneNumber: "+919876543210",
      preferredCourse: "B.Tech Computer Science",
      queryTopic: "Admissions & Eligibility",
      idempotencyKey: `expired-lock-test-${Date.now()}`,
    }),
  });

  const expiredLockData = await expiredLockRes.json();
  const studentAAfterExpiredUnlock = await User.findById(studentA._id);
  const isFreshLockAcquired = studentAAfterExpiredUnlock.callLockUntil && studentAAfterExpiredUnlock.callLockUntil > new Date();

  assert(
    14,
    "Safe Lock Expiry Recovery (Expired lock automatically acquired without getting stuck)",
    expiredLockRes.status === 200 &&
      expiredLockData.success === true &&
      isFreshLockAcquired === true,
    { status: expiredLockRes.status, expiredLockData, isFreshLockAcquired }
  );

  // Close server2
  server2.closeAllConnections?.();
  await new Promise((resolve) => server2.close(resolve));
} catch (err) {
  console.error("Test execution exception:", err);
} finally {
  // Clean synthetic records
  await User.deleteMany({ email: /@synthetic-test-call-edureach\.com$/i });
  await CallRecord.deleteMany({ destination: { $regex: /^\+919/ } });

  // Restore fetch
  global.fetch = originalFetch;

  // Close mongoose
  await mongoose.disconnect();
}

console.log("\n==================== PERSISTENT CALL TEST SUMMARY ====================");
console.log(`Total Tests Run: ${passCount + failCount}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);
console.log("======================================================================\n");

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
