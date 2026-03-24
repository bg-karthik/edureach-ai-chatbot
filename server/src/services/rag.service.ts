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
// TOOL
// ============================================
const createRetrieveTool = (vectorStore: MongoDBAtlasVectorSearch) => {
  return tool(
    async ({ query }: { query: string }) => {
      const docs = await vectorStore.similaritySearch(query, 3);
      return docs.map((d) => d.pageContent).join("\n\n");
    },
    {
      name: "retrieve",
      description: "Search EduReach knowledge base",
      schema: z.object({ query: z.string() }),
    }
  );
};

// ============================================
// MAIN CHAT FUNCTION
// ============================================
export const getRAGResponse = async (
  question: string
): Promise<string> => {
  try {
    const vectorStore = await getVectorStore();
    const retrieve = createRetrieveTool(vectorStore);

    const model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      temperature: 0.7,
      apiKey: getApiKey(), // ✅ FIXED
    });

    const agent = createAgent({
      model,
      tools: [retrieve],
      systemPrompt:
        "You are EduReach Bot. Always use the retrieve tool before answering. " +
        "Answer clearly and based only on retrieved knowledge.",
    });

    const result = await agent.invoke({
      messages: [{ role: "user", content: question }],
    });

    const last = result.messages.at(-1);

    return typeof last?.content === "string"
      ? last.content
      : "No response generated.";
  } catch (error) {
    console.error("RAG Error:", error);
    return "I'm having trouble right now. Please try again.";
  }
};