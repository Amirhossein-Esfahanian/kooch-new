"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { getToken } from "@/lib/owner-api";

type ProfileAvatar = {
  avatarUrl: string | null;
  ensureAvatar: () => Promise<void>;
  refreshAvatar: () => Promise<void>;
  clearAvatar: () => void;
};

const AvatarContext = createContext<ProfileAvatar | null>(null);

export function UserProfileAvatarProvider({ children, eager = false }: { children: ReactNode; eager?: boolean }) {
  const existing = useContext(AvatarContext);
  const { user } = useAuthSession();
  if (existing) return children;
  return <AvatarStateProvider eager={eager} key={user?.userId ?? "anonymous"} userId={user?.userId}>{children}</AvatarStateProvider>;
}

function AvatarStateProvider({ children, eager, userId }: { children: ReactNode; eager: boolean; userId?: number }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const loaded = useRef(false);
  const request = useRef<{ version: number; controller?: AbortController; promise?: Promise<void> }>({ version: 0 });

  useEffect(() => () => { if (avatarUrl) URL.revokeObjectURL(avatarUrl); }, [avatarUrl]);
  useEffect(() => () => { request.current.version++; request.current.controller?.abort(); }, []);

  const refreshAvatar = useCallback(() => {
    request.current.controller?.abort();
    const version = ++request.current.version;
    const controller = new AbortController();
    request.current.controller = controller;
    const promise = (async () => {
      const token = getToken();
      if (!userId || !token) { setAvatarUrl(null); return; }
      const response = await fetch("/api/backend/account/profile/avatar", {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
      });
      if (controller.signal.aborted || version !== request.current.version) return;
      if (response.status === 404) { loaded.current = true; setAvatarUrl(null); return; }
      if (!response.ok) throw new Error("بارگذاری تصویر پروفایل انجام نشد.");
      const blob = await response.blob();
      if (!controller.signal.aborted && version === request.current.version) {
        loaded.current = true;
        setAvatarUrl(URL.createObjectURL(blob));
      }
    })().finally(() => { if (version === request.current.version) request.current.promise = undefined; });
    request.current.promise = promise;
    return promise;
  }, [userId]);

  const ensureAvatar = useCallback(() => {
    if (loaded.current) return Promise.resolve();
    return request.current.promise && !request.current.controller?.signal.aborted ? request.current.promise : refreshAvatar();
  }, [refreshAvatar]);
  const clearAvatar = useCallback(() => {
    request.current.version++;
    request.current.controller?.abort();
    request.current.promise = undefined;
    loaded.current = true;
    setAvatarUrl(null);
  }, []);

  useEffect(() => {
    if (eager) void ensureAvatar().catch(() => {});
  }, [eager, ensureAvatar]);

  const value = useMemo(() => ({ avatarUrl, ensureAvatar, refreshAvatar, clearAvatar }), [avatarUrl, ensureAvatar, refreshAvatar, clearAvatar]);
  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

export function useUserProfileAvatar() {
  const avatar = useContext(AvatarContext);
  if (!avatar) throw new Error("Profile avatar requires UserProfileAvatarProvider");
  return avatar;
}
