import { useState, useRef, useEffect } from "react";
import { X, Phone, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import { initiateCall, getCallStatus } from "../services/vapi.service";
import { vapiFormContent } from "../data/content";
import { getAuthErrorMessage } from "../utils/error.util";

interface CallPopupProps {
  open: boolean;
  onClose: () => void;
}

type CallStatus = "form" | "calling" | "done" | "error";

export default function CallPopup({ open, onClose }: CallPopupProps) {
  const { user } = useAuth();
  const [phone, setPhone] = useState("");
  const [course, setCourse] = useState("");
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState<CallStatus>("form");
  const [statusDetail, setStatusDetail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (status !== "form") return;

    if (!phone.trim() || !course || !topic) {
      toast.error("Please fill in all fields");
      return;
    }

    if (phone.replace(/[^0-9]/g, "").length < 10) {
      toast.error("Please enter a valid phone number (at least 10 digits)");
      return;
    }

    setStatus("calling");
    setStatusDetail(`Dialing ${phone.trim()} via Voice AI counselor...`);
    setErrorMessage("");

    try {
      const res = await initiateCall({
        phoneNumber: phone.trim(),
        preferredCourse: course,
        queryTopic: topic,
      });

      const callId = res?.data?.callId;
      if (callId) {
        let attempts = 0;
        const maxAttempts = 10; // ~30 seconds

        pollTimerRef.current = setInterval(async () => {
          attempts++;
          try {
            const statusRes = await getCallStatus(callId);
            const callData = statusRes?.data;

            if (callData) {
              if (callData.displayStatus) {
                setStatusDetail(callData.displayStatus);
              }

              if (callData.status === "in-progress") {
                setStatusDetail("Call connected! AI Counselor Ava is speaking.");
              }

              if (callData.isFinished) {
                if (pollTimerRef.current) clearInterval(pollTimerRef.current);

                if (callData.status === "ended" && (!callData.endedReason || callData.endedReason.includes("customer-ended") || callData.endedReason.includes("assistant-ended"))) {
                  setStatus("done");
                  setStatusDetail("Call completed successfully. Thank you for speaking with EduReach!");
                  toast.success("Call completed!");
                } else {
                  setStatus("error");
                  setErrorMessage(callData.displayStatus || "Call was disconnected or could not reach destination.");
                  toast.error("Call ended unexpectedly.");
                }
              }
            }
          } catch {
            // Polling error, continue
          }

          if (attempts >= maxAttempts) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setStatus("done");
            setStatusDetail(`Call dispatched! You will receive a ring shortly on ${phone.trim()}.`);
          }
        }, 3000);
      } else {
        setStatus("done");
        setStatusDetail(`Call initiated! You will receive a call shortly on ${phone.trim()}.`);
        toast.success("Call initiated!");
      }
    } catch (error: any) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      const msg = getAuthErrorMessage(error, "Failed to initiate call.");
      setStatus("error");
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  const reset = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    setStatus("form");
    setPhone("");
    setCourse("");
    setTopic("");
    setStatusDetail("");
    setErrorMessage("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto relative">

        {/* Close Button */}
        <button
          onClick={handleClose}
          aria-label="Close popup"
          title="Close"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="bg-maroon rounded-t-2xl px-6 py-5">
          <h3 className="text-xl font-bold text-white">
            Talk to Our AI Counselor
          </h3>
          <p className="text-white/70 text-sm mt-1">
            Get personalized guidance on courses, admissions & more
          </p>
        </div>

        <div className="p-6">
          {status === "form" && (
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Your Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={user?.name || ""}
                  readOnly
                  aria-label="User name"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 text-sm"
                />
              </div>

              {/* Phone */}
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number *
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9876543210"
                    aria-label="Phone Number"
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-maroon focus:ring-1 focus:ring-maroon text-sm"
                  />
                </div>
              </div>

              {/* Course */}
              <div>
                <label htmlFor="course" className="block text-sm font-medium text-gray-700 mb-1">
                  Interested Course *
                </label>
                <select
                  id="course"
                  value={course}
                  onChange={(e) => setCourse(e.target.value)}
                  aria-label="Select course"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-maroon focus:ring-1 focus:ring-maroon text-sm"
                >
                  <option value="">Select a course</option>
                  {vapiFormContent.courses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Topic */}
              <div>
                <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-1">
                  What do you want to know? *
                </label>
                <select
                  id="topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  aria-label="Select topic"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-maroon focus:ring-1 focus:ring-maroon text-sm"
                >
                  <option value="">Select a topic</option>
                  {vapiFormContent.topics.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={status !== "form"}
                aria-label="Call now"
                title="Call now"
                className="w-full bg-maroon text-white py-3 rounded-lg font-semibold hover:bg-maroon-dark disabled:opacity-50 disabled:cursor-not-allowed"
              >
                📞 Call Me Now
              </button>
            </form>
          )}

          {/* Calling */}
          {status === "calling" && (
            <div className="text-center py-10">
              <Loader2 className="w-10 h-10 text-maroon mx-auto animate-spin mb-3" />
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                Calling you now...
              </h3>
              <p className="text-gray-500 text-sm">
                {statusDetail || `Our AI counselor Ava is dialing ${phone}`}
              </p>
            </div>
          )}

          {/* Success */}
          {status === "done" && (
            <div className="text-center py-10">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                Call Dispatched!
              </h3>
              <p className="text-gray-500 text-sm mb-4">
                {statusDetail || `You'll receive a call shortly on ${phone}.`}
              </p>
              <button
                onClick={reset}
                className="text-maroon font-medium text-sm hover:underline"
              >
                Request Another Call
              </button>
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <div className="text-center py-10">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                Call Not Completed
              </h3>
              <p className="text-gray-500 text-sm mb-4">
                {errorMessage || "Something went wrong. Please check your phone number and try again."}
              </p>
              <button
                onClick={reset}
                className="bg-maroon text-white px-5 py-2 rounded-lg text-sm hover:bg-maroon-dark"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}