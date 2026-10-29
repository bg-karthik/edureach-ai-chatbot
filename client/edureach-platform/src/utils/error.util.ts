// ============================================
// FILE: src/utils/error.util.ts
// PURPOSE: User-friendly error message extraction
// ============================================

/**
 * Extracts a safe, descriptive, user-friendly error message from an Axios error,
 * network failure, CORS rejection, or server exception.
 */
export const getAuthErrorMessage = (err: any, fallbackMessage: string): string => {
  if (err?.response) {
    const data = err.response.data;
    if (data?.message && typeof data.message === "string") {
      return data.message;
    }
    if (data?.error && typeof data.error === "string") {
      return data.error;
    }
    if (err.response.status === 409) {
      return "An account with this email already exists.";
    }
    if (err.response.status === 401) {
      return "Invalid email or password.";
    }
    if (err.response.status === 403) {
      return "Access denied or session expired.";
    }
    if (err.response.status >= 500) {
      return "Server error occurred. Please try again shortly.";
    }
  }

  // Axios timeout or network failure (CORS block, offline, connection refused)
  if (err?.code === "ECONNABORTED") {
    return "Request timed out. Please check your internet connection.";
  }

  if (err?.message === "Network Error" || !err?.response) {
    return "Unable to connect to the server. Please check your internet connection or verify the server is running.";
  }

  return err?.message || fallbackMessage;
};

