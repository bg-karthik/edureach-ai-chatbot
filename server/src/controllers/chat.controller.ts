import type { Request, Response, NextFunction } from "express";
import { getRAGResponse, RAGServiceError } from "../services/rag.service.ts";

// POST /api/chat/message
export const sendMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const clientAbortController = new AbortController();

  // Listen to response close: if connection closes before res is sent, client disconnected
  res.on("close", () => {
    if (!res.writableEnded) {
      clientAbortController.abort();
    }
  });

  try {
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ success: false, message: "Message is required." });
      return;
    }

    const answer = await getRAGResponse(message.trim(), clientAbortController.signal);

    if (res.writableEnded || clientAbortController.signal.aborted) {
      return;
    }

    res.json({ success: true, data: { message: answer } });
  } catch (error: any) {
    if (res.writableEnded || clientAbortController.signal.aborted) {
      return;
    }

    if (error instanceof RAGServiceError) {
      console.error(`[RAG_${error.category}] Status: ${error.statusCode} | ${error.internalDetails || error.message}`);
      res.status(error.statusCode).json({
        success: false,
        error: error.category,
        message: error.userMessage,
      });
      return;
    }
    next(error);
  }
};