import { Router } from "express";
import { startCall, getCallStatus } from "../controllers/vapi.controller.ts";
import authMiddleware from "../middleware/auth.middleware.ts";

const router = Router();

router.post("/call", authMiddleware, startCall);
router.get("/call/:id", authMiddleware, getCallStatus);

export default router;
