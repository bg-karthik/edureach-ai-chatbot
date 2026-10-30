import API from "./api";

export const initiateCall = async (data: {
  phoneNumber: string;
  preferredCourse?: string;
  queryTopic?: string;
  idempotencyKey?: string;
}) => {
  const res = await API.post("/vapi/call", {
    phoneNumber: data.phoneNumber,
    preferredCourse: data.preferredCourse || "",
    queryTopic: data.queryTopic || "",
    idempotencyKey: data.idempotencyKey || undefined,
  });

  return res.data;
};

export const getCallStatus = async (callId: string) => {
  const res = await API.get(`/vapi/call/${callId}`);
  return res.data;
};
