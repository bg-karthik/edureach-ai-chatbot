import app from "./app.ts";
import connectDB from "./config/database.config.ts";
import { initializeKnowledgeBase } from "./services/rag.service.ts";

const PORT = process.env.PORT || 5000;

const start = async (): Promise<void> => {
  try {
    // Connect MongoDB
    await connectDB();
    console.log(" MongoDB connected successfully");

    // Initialize RAG knowledge base
    await initializeKnowledgeBase();
    console.log(" Knowledge base initialized");

    // Root route for Render health check
    app.get("/", (_req, res) => {
      res.status(200).json({
        success: true,
        message: "EduReach Backend Running Successfully"
      });
    });

    // Start Express server
    app.listen(PORT, () => {
      console.log(" EduReach Server is running!");
      console.log(` Port: ${PORT}`);
      console.log(` Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(` Node Version: ${process.version}`);
    });

  } catch (error) {
    console.error(" Failed to start server:", error);
    process.exit(1);
  }
};

start();