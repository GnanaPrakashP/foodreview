import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";
import { getCircleRelationshipsForName } from "@/lib/circle-db";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import type { Story, StoryVisibility } from "@/lib/types";

type StoriesDb = {
  auth: {
    getUser: () => Promise<{
      data: {
        user: {
          id: string;
          email?: string | null;
          user_metadata?: Record<string, unknown>;
        } | null;
      };
      error?: unknown;
    }>;
  };
  from: (table: string) => any;
};

const STORY_SELECT = [
  "id",
  "author_name",
  "media_url",
  "storage_path",
  "caption",
  "visibility",
  "status",
  "created_at",
  "expires_at",
  "deleted_at",
  "hidden_at",
  "reported_at",
].join(", ");

export type StoryGroup = {
  authorName: string;
  displayName: string;
  stories: Story[];
};

export type StoriesPage = {
  myName: string;
  groups: StoryGroup[];
  profileMap: Record<string, string>;
};

function cleanCaption(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const caption = value.trim();
  if (!caption) return null;
  return caption.slice(0, 180);
}

export function isValidStoryVisibility(value: unknown): value is StoryVisibility {
  return value === "public" || value === "circle";
}

export async function getStoriesPage(supabase: StoriesDb): Promise<StoriesPage> {
  const actor = await getAuthenticatedCircleActor(supabase);
  if (!actor) return { myName: "", groups: [], profileMap: {} };

  const readDb = createAdminClient();
  const relationships = await getCircleRelationshipsForName(readDb, actor.actorName);
  const visibleAuthors = Array.from(new Set([actor.actorName, ...relationships.joinedCircles].filter(Boolean)));
  if (visibleAuthors.length === 0) return { myName: actor.actorName, groups: [], profileMap: {} };

  const { data: circleData, error: circleError } = await readDb
    .from("stories")
    .select(STORY_SELECT)
    .in("author_name", visibleAuthors)
    .gt("expires_at", new Date().toISOString())
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(80)
    .returns<Story[]>();

  if (circleError) throw circleError;

  const { data: publicData, error: publicError } = await readDb
    .from("stories")
    .select(STORY_SELECT)
    .eq("visibility", "public")
    .gt("expires_at", new Date().toISOString())
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(80)
    .returns<Story[]>();

  if (publicError) throw publicError;

  const storyMap = new Map<string, Story>();
  for (const story of [...(circleData ?? []), ...(publicData ?? [])]) {
    storyMap.set(story.id, story);
  }
  const stories = Array.from(storyMap.values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 80);
  const profileMap = await buildProfileDisplayMap(readDb, stories.map((story) => story.author_name));
  const byAuthor = new Map<string, Story[]>();

  for (const story of stories) {
    const list = byAuthor.get(story.author_name) ?? [];
    list.push(story);
    byAuthor.set(story.author_name, list);
  }

  const groups = Array.from(byAuthor.entries()).map(([authorName, authorStories]) => ({
    authorName,
    displayName: profileMap[authorName] ?? authorName,
    stories: authorStories.sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));

  groups.sort((a, b) => {
    if (a.authorName === actor.actorName) return -1;
    if (b.authorName === actor.actorName) return 1;
    return b.stories[b.stories.length - 1].created_at.localeCompare(a.stories[a.stories.length - 1].created_at);
  });

  return { myName: actor.actorName, groups, profileMap };
}

export async function createStory(
  supabase: StoriesDb,
  input: {
    mediaUrl: unknown;
    storagePath?: unknown;
    caption?: unknown;
    visibility?: unknown;
  }
): Promise<{ id: string }> {
  const actor = await getAuthenticatedCircleActor(supabase);
  if (!actor) throw new Error("Authentication required");

  const mediaUrl = typeof input.mediaUrl === "string" ? input.mediaUrl.trim() : "";
  if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
    throw new Error("Story photo is required");
  }

  const visibility = isValidStoryVisibility(input.visibility) ? input.visibility : "circle";
  const caption = cleanCaption(input.caption);
  const storagePath = typeof input.storagePath === "string" && input.storagePath.trim()
    ? input.storagePath.trim()
    : null;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const writeDb = createAdminClient();
  const { data, error } = await writeDb
    .from("stories")
    .insert({
      author_name: actor.actorName,
      media_url: mediaUrl,
      storage_path: storagePath,
      caption,
      visibility,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: data.id as string };
}
