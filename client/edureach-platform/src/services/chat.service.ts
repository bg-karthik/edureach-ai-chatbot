import API from "./api";

// Backend response: { success: true, data: { message: "answer text" } }
// res.data = { success, data: { message } }
// We return res.data.data so ChatDrawer gets { message: "answer text" }
export const sendMessage = async (message: string, signal?: AbortSignal) => {
  // Use a chat-specific timeout (25s) that is safely longer than the backend RAG deadline (15s)
  const res = await API.post(
    "/chat/message",
    { message },
    {
      signal,
      timeout: 25000,
    }
  );
  return res.data.data; // { message: "answer text" }
};