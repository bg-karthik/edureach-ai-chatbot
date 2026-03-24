import { Router } from "express";
import { sendMessage } from "../controllers/chat.controller.ts";
import authMiddleware from "../middleware/auth.middleware.ts";

const router = Router();

router.post("/message", authMiddleware, sendMessage);

export default router;