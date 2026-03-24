import API from "./api";

export const initiateCall = async (data: {
  phoneNumber: string;
  preferredCourse?: string;
  queryTopic?: string;
}) => {
  const res = await API.post("/vapi/call", {
    phoneNumber: data.phoneNumber,
    preferredCourse: data.preferredCourse || "",
    queryTopic: data.queryTopic || "",
  });

  return res.data;
};