import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { getMe } from "../services/auth.service";

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const authSessionRef = useRef(0);

  // On mount: if token exists in localStorage, fetch user profile
  useEffect(() => {
    // Purge legacy unauthenticated shared chat cache if present
    try {
      localStorage.removeItem("chat");
    } catch {
      // Ignore
    }

    const token = localStorage.getItem("token");
    if (token) {
      const session = ++authSessionRef.current;
      getMe()
        .then((data) => {
          if (authSessionRef.current !== session) return;
          setUser(data.user);
        })
        .catch(() => {
          if (authSessionRef.current !== session) return;
          localStorage.removeItem("token");
          setUser(null);
        })
        .finally(() => {
          if (authSessionRef.current === session) {
            setLoading(false);
          }
        });
    } else {
      setLoading(false);
    }
  }, []);

  // Multi-tab synchronization for token and account switching
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "token") {
        if (!e.newValue) {
          // Token cleared in another tab -> logout immediately
          authSessionRef.current += 1;
          setUser(null);
        } else if (e.newValue !== e.oldValue) {
          // Token changed in another tab (account switch)
          const session = ++authSessionRef.current;
          setLoading(true);
          getMe()
            .then((data) => {
              if (authSessionRef.current !== session) return;
              setUser(data.user);
            })
            .catch(() => {
              if (authSessionRef.current !== session) return;
              localStorage.removeItem("token");
              setUser(null);
            })
            .finally(() => {
              if (authSessionRef.current === session) {
                setLoading(false);
              }
            });
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Save token to localStorage and fetch user
  const login = (token: string) => {
    localStorage.setItem("token", token);
    try {
      localStorage.removeItem("chat"); // Purge legacy shared chat cache
    } catch {
      // Ignore
    }
    const session = ++authSessionRef.current;
    setLoading(true);
    getMe()
      .then((data) => {
        if (authSessionRef.current !== session) return;
        setUser(data.user);
      })
      .catch(() => {
        if (authSessionRef.current !== session) return;
        localStorage.removeItem("token");
        setUser(null);
      })
      .finally(() => {
        if (authSessionRef.current === session) {
          setLoading(false);
        }
      });
  };

  const logout = () => {
    authSessionRef.current += 1; // Invalidate any pending getMe() responses
    localStorage.removeItem("token");
    try {
      localStorage.removeItem("chat"); // Purge legacy shared chat cache
    } catch {
      // Ignore
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
