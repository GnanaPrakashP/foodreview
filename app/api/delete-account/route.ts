import { NextRequest, NextResponse } from "next/server";
import { MEMORY_MEDIA_BUCKET } from "@/lib/memory-media-policy";
import { memoryErrorKind, memoryOperationDurationMs, recordMemoryOperation } from "@/lib/server/memory-observability";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteSupabase } from "@/lib/server/route-supabase";

type MediaPathRow = {
  storage_path: string | null;
};

function uniquePaths(rows: MediaPathRow[] | null) {
  return Array.from(new Set((rows ?? [])
    .map((row) => row.storage_path)
    .filter((value): value is string => Boolean(value))));
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const supabase = await createRouteSupabase(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: mediaRows, error: mediaPathError } = await admin
      .rpc("shared_memory_account_media_paths", { p_user_id: user.id });
    if (mediaPathError) throw mediaPathError;

    const paths = uniquePaths(Array.isArray(mediaRows) ? mediaRows as MediaPathRow[] : []);
    if (paths.length > 0) {
      const { error: storageError } = await admin.storage.from(MEMORY_MEDIA_BUCKET).remove(paths);
      if (storageError) throw storageError;
    }

    const { error } = await supabase.rpc("delete_current_account");
    if (error) throw error;

    recordMemoryOperation("account_delete.run", {
      durationMs: memoryOperationDurationMs(startedAt),
      removedObjects: paths.length,
      status: "success",
      statusCode: 200
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    recordMemoryOperation("account_delete.run", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(error),
      status: "error",
      statusCode: 500
    });
    return NextResponse.json({ error: "Unable to delete account" }, { status: 500 });
  }
}
