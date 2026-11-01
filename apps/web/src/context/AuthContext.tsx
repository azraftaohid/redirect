import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  type AuthPrincipal,
  AccessSessionExpiredError,
  ApiClientError,
  bootstrapInitialTokenPing,
  clearStoredToken,
  getStoredToken,
  getStoredTokenSetAt,
  setStoredToken,
  verifyAuth,
} from "@/api/client";

export type AuthStatus = "loading" | "unauthenticated" | "authenticated";

export interface AuthContextValue {
  status: AuthStatus;
  token: string | null;
  principal: AuthPrincipal | null;
  accessExpired: boolean;
  warning: string | null;
  login: (token: string) => Promise<void>;
  logout: () => void;
  updateActiveToken: (newToken: string) => void;
  clearAccessExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const KV_PROPAGATION_GRACE_MS = 60_000;

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [principal, setPrincipal] = useState<AuthPrincipal | null>(null);
  const [accessExpired, setAccessExpired] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // Listen for Cloudflare Access session expiration events dispatched across the app
  useEffect(() => {
    const handleAccessExpired = () => {
      setAccessExpired(true);
    };

    window.addEventListener("redirect:access-expired", handleAccessExpired);
    return () => {
      window.removeEventListener("redirect:access-expired", handleAccessExpired);
    };
  }, []);

  // Listen for unauthorized 401 events dispatched on stored token failure
  useEffect(() => {
    const handleUnauthorized = () => {
      const setAt = getStoredTokenSetAt();
      const elapsed = Date.now() - setAt;

      if (elapsed < KV_PROPAGATION_GRACE_MS) {
        setWarning(
          "Saved token could not be verified yet. KV propagation across Cloudflare edge locations may take up to 60 seconds."
        );
        return;
      }

      clearStoredToken();
      setToken(null);
      setPrincipal(null);
      setStatus("unauthenticated");
      setWarning("Session expired or token revoked. Please log in again.");
    };

    window.addEventListener("redirect:unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("redirect:unauthorized", handleUnauthorized);
    };
  }, []);

  // Verify stored token or trigger background bootstrap on initial load
  useEffect(() => {
    let cancelled = false;

    async function initAuth() {
      const token = getStoredToken();

      if (!token) {
        if (!cancelled) {
          setStatus("unauthenticated");
        }
        // Ping to ensure server bootstraps initial token in KV if this is first launch
        bootstrapInitialTokenPing();
        return;
      }

      try {
        const res = await verifyAuth(token);
        if (!cancelled) {
          setPrincipal(res.principal);
          setStatus("authenticated");
          setWarning(null);
        }
      } catch (err) {
        if (cancelled) return;

        if (err instanceof AccessSessionExpiredError) {
          setAccessExpired(true);
          setStatus("unauthenticated");
          return;
        }

        if (err instanceof ApiClientError && err.status === 401) {
          const setAt = getStoredTokenSetAt();
          const elapsed = Date.now() - setAt;

          if (elapsed < KV_PROPAGATION_GRACE_MS) {
            // Within KV propagation window, preserve token and notify user
            setStatus("unauthenticated");
            setWarning(
              "Saved token could not be verified yet. KV propagation across Cloudflare edge locations may take up to 60 seconds."
            );
            return;
          }

          // Beyond grace period: token is truly invalid or revoked
          clearStoredToken();
          setToken(null);
          setPrincipal(null);
          setStatus("unauthenticated");
          setWarning("Session expired or token revoked. Please log in again.");
          return;
        }

        // Generic network or server error: preserve token, show unauthenticated status
        setStatus("unauthenticated");
        setWarning(err instanceof Error ? err.message : "Authentication error occurred.");
      }
    }

    initAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (candidateToken: string): Promise<void> => {
    const trimmed = candidateToken.trim();
    if (!trimmed) {
      throw new Error("Token cannot be empty");
    }

    const res = await verifyAuth(trimmed);
    setStoredToken(trimmed);
    setToken(trimmed);
    setPrincipal(res.principal);
    setStatus("authenticated");
    setWarning(null);
    setAccessExpired(false);
  }, []);

  const logout = useCallback((): void => {
    clearStoredToken();
    setToken(null);
    setPrincipal(null);
    setStatus("unauthenticated");
    setWarning(null);
  }, []);

  const updateActiveToken = useCallback((newToken: string): void => {
    const trimmed = newToken.trim();
    setStoredToken(trimmed);
    setToken(trimmed);
  }, []);

  const clearAccessExpired = useCallback((): void => {
    setAccessExpired(false);
  }, []);

  const value: AuthContextValue = {
    status,
    token,
    principal,
    accessExpired,
    warning,
    login,
    logout,
    updateActiveToken,
    clearAccessExpired,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
