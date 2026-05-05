"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Syncs the logged-in user's display name into localStorage so the
// rest of the app (which reads fc_my_name) knows who the current user is.
export default function AuthSync() {
  useEffect(() => {
    const supabase = createClient();

    async function sync() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const user = session.user;
      const name =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "";
      if (name) localStorage.setItem("fc_my_name", name);
    }

    sync();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return;
      const user = session.user;
      const name =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "";
      if (name) localStorage.setItem("fc_my_name", name);
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
