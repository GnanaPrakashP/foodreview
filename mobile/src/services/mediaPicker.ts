import * as ImagePicker from "expo-image-picker";
import { MEMORY_MEDIA_MAX_ITEMS, MEMORY_VIDEO_MAX_DURATION_MS } from "@/constants/memoryMediaPolicy";

const imageMediaTypes: ImagePicker.MediaType[] = ["images"];
const allMediaTypes: ImagePicker.MediaType[] = ["images", "videos"];
const POST_VIDEO_MAX_DURATION_MS = 30_000;

export type PostMediaPickerResult = {
  assets: ImagePicker.ImagePickerAsset[];
  error: string | null;
};

// Multi-select gallery pick for the Post-a-Bite flow. selectionLimit should
// be the post's remaining free media slots.
export async function pickPostMediaFromGallery(selectionLimit: number): Promise<PostMediaPickerResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      assets: [],
      error: "Photo library permission was not granted."
    };
  }

  const limit = Math.max(1, Math.floor(selectionLimit));
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    allowsMultipleSelection: limit > 1,
    mediaTypes: allMediaTypes,
    quality: 0.9,
    selectionLimit: limit,
    videoMaxDuration: POST_VIDEO_MAX_DURATION_MS / 1000
  });

  if (result.canceled) {
    return { assets: [], error: null };
  }

  return {
    assets: result.assets.slice(0, limit),
    error: null
  };
}

export type RecentPostImage = {
  id: string;
  uri: string;
};

export type MemoryMediaPickerResult = {
  asset: ImagePicker.ImagePickerAsset | null;
  assets: ImagePicker.ImagePickerAsset[];
  error: string | null;
};

export async function pickPostImageFromGallery() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      asset: null,
      error: "Photo library permission was not granted."
    };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    mediaTypes: imageMediaTypes,
    quality: 0.9,
    selectionLimit: 1
  });

  if (result.canceled) {
    return { asset: null, error: null };
  }

  return {
    asset: result.assets[0] ?? null,
    error: null
  };
}

export async function pickAvatarFromGallery() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      asset: null,
      error: "Photo library permission was not granted."
    };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: true,
    aspect: [1, 1],
    mediaTypes: imageMediaTypes,
    quality: 0.85,
    selectionLimit: 1
  });

  if (result.canceled) {
    return { asset: null, error: null };
  }

  return {
    asset: result.assets[0] ?? null,
    error: null
  };
}

export async function pickMemoryMediaFromGallery(): Promise<MemoryMediaPickerResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      asset: null,
      assets: [],
      error: "Photo library permission was not granted."
    };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    allowsMultipleSelection: true,
    mediaTypes: allMediaTypes,
    quality: 0.9,
    selectionLimit: MEMORY_MEDIA_MAX_ITEMS,
    videoMaxDuration: MEMORY_VIDEO_MAX_DURATION_MS / 1000
  });

  if (result.canceled) {
    return { asset: null, assets: [], error: null };
  }

  return {
    asset: result.assets[0] ?? null,
    assets: result.assets,
    error: null
  };
}

export async function pickSingleMemoryMediaFromGallery(): Promise<MemoryMediaPickerResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      asset: null,
      assets: [],
      error: "Photo library permission was not granted."
    };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    allowsMultipleSelection: false,
    mediaTypes: allMediaTypes,
    quality: 0.9,
    selectionLimit: 1,
    videoMaxDuration: MEMORY_VIDEO_MAX_DURATION_MS / 1000
  });

  if (result.canceled) {
    return { asset: null, assets: [], error: null };
  }

  const asset = result.assets[0] ?? null;
  return {
    asset,
    assets: asset ? [asset] : [],
    error: null
  };
}

export async function pickMemoryMediaFromCamera(): Promise<MemoryMediaPickerResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return {
      asset: null,
      assets: [],
      error: "Camera permission was not granted."
    };
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    mediaTypes: allMediaTypes,
    quality: 0.9,
    videoMaxDuration: MEMORY_VIDEO_MAX_DURATION_MS / 1000
  });

  if (result.canceled) {
    return { asset: null, assets: [], error: null };
  }

  return {
    asset: result.assets[0] ?? null,
    assets: result.assets,
    error: null
  };
}

export async function pickPostMediaFromCamera() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return {
      asset: null,
      error: "Camera permission was not granted."
    };
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    mediaTypes: allMediaTypes,
    quality: 0.9,
    videoMaxDuration: POST_VIDEO_MAX_DURATION_MS / 1000
  });

  if (result.canceled) {
    return { asset: null, error: null };
  }

  return {
    asset: result.assets[0] ?? null,
    error: null
  };
}

export async function pickPostImageFromCamera() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return {
      asset: null,
      error: "Camera permission was not granted."
    };
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    aspect: [4, 5],
    mediaTypes: imageMediaTypes,
    quality: 0.9
  });

  if (result.canceled) {
    return { asset: null, error: null };
  }

  return {
    asset: result.assets[0] ?? null,
    error: null
  };
}

export type RecentPostImagesStatus = "granted" | "denied" | "unavailable";

export type RecentPostImagesPage = {
  assets: RecentPostImage[];
  endCursor: string | null;
  error: string | null;
  hasNextPage: boolean;
  status: RecentPostImagesStatus;
};

const UNAVAILABLE_PAGE: RecentPostImagesPage = {
  assets: [],
  endCursor: null,
  error: null,
  hasNextPage: false,
  status: "unavailable"
};

export async function listRecentPostImages(options?: { after?: string; limit?: number }): Promise<RecentPostImagesPage> {
  const limit = options?.limit ?? 30;

  try {
    const MediaLibrary = await import("expo-media-library");

    // Request standard read access (no granular scope): the granular ["photo"] scope
    // depends on the config plugin, which Expo Go does not apply.
    // Only check on paging requests; on the first load, ask so the grid can fill.
    let permission = await MediaLibrary.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain && !options?.after) {
      permission = await MediaLibrary.requestPermissionsAsync();
    }
    if (!permission.granted) {
      return { assets: [], endCursor: null, error: null, hasNextPage: false, status: "denied" };
    }

    const result = await MediaLibrary.getAssetsAsync({
      after: options?.after,
      first: limit,
      mediaType: MediaLibrary.MediaType.photo,
      sortBy: [MediaLibrary.SortBy.creationTime]
    });

    return {
      assets: result.assets.map((asset) => ({
        id: asset.id,
        uri: asset.uri
      })),
      endCursor: result.endCursor ?? null,
      error: null,
      hasNextPage: result.hasNextPage,
      status: "granted"
    };
  } catch {
    // Expo Go rejects the native MediaLibrary permission/asset calls (documented
    // limitation, mainly on Android). Degrade to the Library picker instead of crashing.
    return UNAVAILABLE_PAGE;
  }
}

export async function imageFromRecentAsset(asset: RecentPostImage) {
  const MediaLibrary = await import("expo-media-library");
  const info = await MediaLibrary.getAssetInfoAsync(asset.id);
  return {
    asset: {
      mimeType: null,
      uri: info.localUri ?? asset.uri
    },
    error: null
  };
}

export const pickPostMediaPlaceholder = pickPostImageFromGallery;
