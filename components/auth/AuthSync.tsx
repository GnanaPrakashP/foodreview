"use client";

import { useEffect, useRef } from "react";
import { clearStoredActor, getStoredActorName, syncStoredActor } from "@/lib/browser-actor";
import { invalidateViewerCaches } from "@/lib/browser-api-cache";
import { createClient } from "@/lib/supabase/client";

// Syncs the logged-in user's identity into browser actor state so older
// client-only flows know who the current user is.
export default function AuthSync() {
  const syncedUsernameRef = useRef("");

  useEffect(() => {
    const supabase = createClient();

    function syncUser(meta: Record<string, unknown>, email: string | null | undefined) {
      const username = (meta.username as string) || email?.split("@")[0] || "";
      const displayName = (meta.full_name as string) || (meta.name as string) || "";
      if (username && syncedUsernameRef.current && syncedUsernameRef.current !== username) {
        invalidateViewerCaches();
      }
      syncStoredActor({ name: username, displayName });
      syncedUsernameRef.current = username;
    }

    function clearUser() {
      if (syncedUsernameRef.current || getStoredActorName()) {
        invalidateViewerCaches();
      }
      clearStoredActor();
      syncedUsernameRef.current = "";
    }

    async function sync() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        clearUser();
        return;
      }
      syncUser(session.user.user_metadata ?? {}, session.user.email);
    }

    sync();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        clearUser();
        return;
      }
      syncUser(session.user.user_metadata ?? {}, session.user.email);
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
