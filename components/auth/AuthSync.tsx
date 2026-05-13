"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Syncs the logged-in user's display name into localStorage so the
// rest of the app (which reads fc_my_name) knows who the current user is.
export default function AuthSync() {
  useEffect(() => {
    const supabase = createClient();

    function syncUser(meta: Record<string, unknown>, email: string | null | undefined) {
      const username = (meta.username as string) || email?.split("@")[0] || "";
      const displayName = (meta.full_name as string) || (meta.name as string) || "";
      if (username) localStorage.setItem("fc_my_name", username);
      if (displayName) localStorage.setItem("fc_display_name", displayName);
    }

    async function sync() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      syncUser(session.user.user_metadata ?? {}, session.user.email);
    }

    sync();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return;
      syncUser(session.user.user_metadata ?? {}, session.user.email);
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
