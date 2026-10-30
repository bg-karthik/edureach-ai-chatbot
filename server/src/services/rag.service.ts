import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { createAgent, tool } from "langchain";
import {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} from "@langchain/google-genai";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { z } from "zod";

// ---- __dirname ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- MongoDB ----
let mongoClient: MongoClient | null = null;

const getMongoClient = async (): Promise<MongoClient> => {
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI || "");
    await mongoClient.connect();
  }
  return mongoClient;
};

// ---- ENV CHECK (IMPORTANT) ----
const getApiKey = (): string => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is missing in .env");
  }
  return key;
};

// ---- EMBEDDINGS ----
const getEmbeddings = () => {
  return new GoogleGenerativeAIEmbeddings({
    apiKey: getApiKey(),
    model: "gemini-embedding-001",
    maxRetries: 1,
  });
};

// ---- VECTOR STORE ----
const getVectorStore = async () => {
  const client = await getMongoClient();
  const collection = client.db("edureach_db").collection("knowledge_docs");

  return new MongoDBAtlasVectorSearch(getEmbeddings(), {
    collection: collection as any,
    indexName: "edureach_vector_index",
    textKey: "text",
    embeddingKey: "embedding",
  });
};

// ============================================
// INDEX KNOWLEDGE BASE
// ============================================
export const initializeKnowledgeBase = async (): Promise<void> => {
  const client = await getMongoClient();
  const collection = client.db("edureach_db").collection("knowledge_docs");

  const existing = await collection.findOne({
    embedding: { $exists: true, $not: { $size: 0 } },
  });

  if (existing) {
    const count = await collection.countDocuments();
    console.log(` Knowledge base ready (${count} chunks)`);
    return;
  }

  console.log(" Indexing knowledge base...");

  const embeddings = getEmbeddings();

  // Test API key
  try {
    const test = await embeddings.embedQuery("test");
    console.log(` API OK — embedding size: ${test.length}`);
  } catch (err: any) {
    console.error(" Embedding failed:", err.message);
    throw err;
  }

  // Load file
  const filePath = path.join(
    __dirname,
    "../../knowledge-base/edureach-knowledge.txt"
  );
  const loader = new TextLoader(filePath);
  const docs = await loader.load();

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const splits = await splitter.splitDocuments(docs);

  const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
    collection: collection as any,
    indexName: "edureach_vector_index",
    textKey: "text",
    embeddingKey: "embedding",
  });

  await vectorStore.addDocuments(splits);

  console.log(` Indexed ${splits.length} chunks`);
};

// ============================================
// ERROR CLASSIFICATION
// ============================================
export type RAGErrorCategory =
  | "QUOTA_EXHAUSTED"
  | "AUTH_FAILED"
  | "MODEL_NOT_FOUND"
  | "DATABASE_ERROR"
  | "TIMEOUT"
  | "PROVIDER_ERROR";

export class RAGServiceError extends Error {
  constructor(
    public readonly category: RAGErrorCategory,
    public readonly statusCode: number,
    public readonly userMessage: string,
    public readonly internalDetails?: string
  ) {
    super(userMessage);
    this.name = "RAGServiceError";
  }
}

export const classifyRAGError = (error: any): RAGServiceError => {
  const status = error?.status || error?.statusCode || error?.code;
  const msg = (error?.message || "").toLowerCase();
  const errorDetails = JSON.stringify(error?.errorDetails || "");

  // 1. Quota / Rate limit (HTTP 429)
  if (
    status === 429 ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    errorDetails.includes("QuotaFailure")
  ) {
    return new RAGServiceError(
      "QUOTA_EXHAUSTED",
      429,
      "The AI counselor is currently operating at maximum capacity. Please try again shortly.",
      "Google Gemini free-tier quota exhausted (HTTP 429 RESOURCE_EXHAUSTED)"
    );
  }

  // 2. Authentication / Permissions (HTTP 503 / 401)
  if (
    status === 401 ||
    status === 403 ||
    msg.includes("api_key_invalid") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("gemini_api_key is missing")
  ) {
    return new RAGServiceError(
      "AUTH_FAILED",
      503,
      "AI counselor service configuration error. Please contact the administrator.",
      `Gemini authentication error: ${error?.message || status}`
    );
  }

  // 3. Model Not Found / Unsupported (HTTP 503 / 404)
  if (status === 404 || msg.includes("not found") || msg.includes("is not supported")) {
    return new RAGServiceError(
      "MODEL_NOT_FOUND",
      503,
      "AI counselor model is temporarily unavailable. Please try again shortly.",
      `Gemini model not found: ${error?.message || status}`
    );
  }

  // 4. Database / Atlas Vector Search
  if (
    msg.includes("mongodb") ||
    msg.includes("vector search") ||
    msg.includes("connection") ||
    msg.includes("topology") ||
    error?.name === "MongoServerError" ||
    error?.name === "MongoNetworkError"
  ) {
    return new RAGServiceError(
      "DATABASE_ERROR",
      503,
      "College knowledge base is temporarily unreachable. Please try again shortly.",
      `MongoDB/Atlas Vector Search error: ${error?.message || "unknown"}`
    );
  }

  // 5. Timeout
  if (
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    error?.name === "AbortError" ||
    error?.name === "TimeoutError"
  ) {
    return new RAGServiceError(
      "TIMEOUT",
      504,
      "The AI counselor request timed out. Please try again.",
      `Upstream timeout: ${error?.message || "unknown"}`
    );
  }

  // 6. Generic Provider Error
  return new RAGServiceError(
    "PROVIDER_ERROR",
    503,
    "The AI counselor is temporarily unavailable. Please try again.",
    `Upstream provider error: ${error?.message || "unknown"}`
  );
};

// ============================================
// MAIN CHAT FUNCTION
// ============================================
export const getRAGResponse = async (
  question: string,
  clientSignal?: AbortSignal
): Promise<string> => {
  let context = "";
  try {
    const vectorStore = await getVectorStore();
    const docs = await vectorStore.similaritySearch(question, 3);
    context = docs.map((d) => d.pageContent).join("\n\n");
  } catch (dbErr: any) {
    console.error("[RAG_DB_SEARCH_FAIL] Vector search retrieval error:", dbErr?.message || dbErr);
    throw classifyRAGError(dbErr);
  }

  const promptText =
    "You are EduReach Bot, the official AI counselor for EduReach College. " +
    "Answer student questions accurately, politely, and concisely based strictly on the retrieved college knowledge below. " +
    "If the answer cannot be determined from the knowledge base, politely guide the student on how to contact admissions.\n\n" +
    `[COLLEGE KNOWLEDGE BASE]:\n${context}\n\n` +
    `Student Question: ${question}`;

  const primaryModel = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const candidateModels = [
    primaryModel,
    ...(primaryModel !== "gemini-flash-lite-latest" ? ["gemini-flash-lite-latest"] : []),
    "gemini-flash-latest",
  ];

  let lastError: any = null;

  for (const modelName of candidateModels) {
    try {
      const apiKey = getApiKey();
      const timeoutSignal = AbortSignal.timeout(15000);
      const requestSignal = clientSignal
        ? AbortSignal.any([clientSignal, timeoutSignal])
        : timeoutSignal;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: promptText }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
        }),
        signal: requestSignal,
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.error?.message || `HTTP ${res.status}`;
        console.warn(`[RAG_MODEL_WARN] Model '${modelName}' failed with HTTP ${res.status}: ${errorMsg.slice(0, 80)}`);
        const errObj = { status: res.status, message: errorMsg, errorDetails: data.error?.details };
        lastError = errObj;
        const classified = classifyRAGError(errObj);
        if (classified.category === "AUTH_FAILED") {
          throw classified;
        }
        continue;
      }

      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (answer && typeof answer === "string" && answer.trim()) {
        return answer.trim();
      }
    } catch (err: any) {
      if (err instanceof RAGServiceError) throw err;
      lastError = err;
      console.warn(`[RAG_MODEL_WARN] Model '${modelName}' exception: ${err.message?.slice(0, 80)}`);
      // If the client aborted or closed the connection, stop candidate fallback loop immediately
      if (clientSignal?.aborted) {
        throw classifyRAGError(err);
      }
      continue;
    }
  }

  // If all candidate models failed, throw classified RAGServiceError
  throw classifyRAGError(lastError || new Error("No response generated from AI provider."));
};