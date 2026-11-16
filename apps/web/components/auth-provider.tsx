"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ApiError,
  apiFetch,
  type AuthUser,
  type Organization,
} from "@/lib/api";

const tokenKey = "docuflow.token";
const userKey = "docuflow.user";
const organizationKey = "docuflow.organization";

type AuthContextValue = {
  ready: boolean;
  token: string | null;
  user: AuthUser | null;
  organizations: Organization[];
  organization: Organization | null;
  organizationsLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  selectOrganization: (id: string) => void;
  refreshOrganizations: () => Promise<Organization[]>;
  createOrganization: (name: string) => Promise<Organization>;
  handleApiError: (error: unknown) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function tokenExpired(token: string) {
  const [, payload] = token.split(".");
  if (!payload) return true;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized)) as { exp?: number };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 <= Date.now() : true;
  } catch {
    return true;
  }
}

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(userKey);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);

  const logout = useCallback(() => {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(userKey);
    localStorage.removeItem(organizationKey);
    setToken(null);
    setUser(null);
    setOrganizations([]);
    setOrganizationId(null);
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem(tokenKey);
    const storedUser = readStoredUser();
    if (storedToken && storedUser && !tokenExpired(storedToken)) {
      setToken(storedToken);
      setUser(storedUser);
      setOrganizationId(localStorage.getItem(organizationKey));
    } else if (storedToken) {
      logout();
    }
    setReady(true);
  }, [logout]);

  const storeSession = useCallback((session: { user: AuthUser; accessToken: string }) => {
    localStorage.setItem(tokenKey, session.accessToken);
    localStorage.setItem(userKey, JSON.stringify(session.user));
    setToken(session.accessToken);
    setUser(session.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await apiFetch<{ user: AuthUser; accessToken: string }>("/api/v1/auth/login", {
        method: "POST",
        body: { email, password },
      });
      storeSession(session);
    },
    [storeSession],
  );

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const session = await apiFetch<{ user: AuthUser; accessToken: string }>("/api/v1/auth/register", {
        method: "POST",
        body: { email, password, ...(name ? { name } : {}) },
      });
      storeSession(session);
    },
    [storeSession],
  );

  const refreshOrganizations = useCallback(async () => {
    if (!token) return [];
    setOrganizationsLoading(true);
    try {
      const result = await apiFetch<Organization[]>("/api/v1/organizations", { token });
      setOrganizations(result);
      setOrganizationId((current) => {
        const next = current && result.some((item) => item.id === current) ? current : (result[0]?.id ?? null);
        if (next) localStorage.setItem(organizationKey, next);
        else localStorage.removeItem(organizationKey);
        return next;
      });
      return result;
    } finally {
      setOrganizationsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void refreshOrganizations().catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) logout();
    });
  }, [token, refreshOrganizations, logout]);

  const selectOrganization = useCallback((id: string) => {
    setOrganizationId(id);
    localStorage.setItem(organizationKey, id);
  }, []);

  const createOrganization = useCallback(
    async (name: string) => {
      const created = await apiFetch<Organization>("/api/v1/organizations", {
        method: "POST",
        token,
        body: { name },
      });
      setOrganizations((current) => [...current, created]);
      setOrganizationId(created.id);
      localStorage.setItem(organizationKey, created.id);
      return created;
    },
    [token],
  );

  const handleApiError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        logout();
        return true;
      }
      return false;
    },
    [logout],
  );

  const organization = useMemo(
    () => organizations.find((item) => item.id === organizationId) ?? null,
    [organizations, organizationId],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      token,
      user,
      organizations,
      organization,
      organizationsLoading,
      login,
      register,
      logout,
      selectOrganization,
      refreshOrganizations,
      createOrganization,
      handleApiError,
    }),
    [
      ready,
      token,
      user,
      organizations,
      organization,
      organizationsLoading,
      login,
      register,
      logout,
      selectOrganization,
      refreshOrganizations,
      createOrganization,
      handleApiError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
