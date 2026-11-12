"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import type { SessionResponse, User } from "./types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, displayName: string) => Promise<User>;
  loginWithGoogleCode: (code: string, redirectUri: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refreshUser = useCallback(async () => {
    try {
      const me = await api<User>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
    });
    (async () => {
      if (getToken()) {
        await refreshUser();
      } else {
        // Try cookie-based refresh for persistent sessions
        try {
          const data = await api<SessionResponse>("/auth/refresh", { method: "POST" });
          setToken(data.access_token);
          setUser(data.user);
        } catch {
          /* not logged in */
        }
      }
      setLoading(false);
    })();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<SessionResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const data = await api<SessionResponse>("/auth/register", {
      method: "POST",
      body: { email, password, display_name: displayName },
    });
    setToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  const loginWithGoogleCode = useCallback(async (code: string, redirectUri: string) => {
    const data = await api<SessionResponse>("/auth/google", {
      method: "POST",
      body: { code, redirect_uri: redirectUri },
    });
    setToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <Ctx.Provider value={{ user, loading, login, register, loginWithGoogleCode, logout, refreshUser }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
