import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";

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
    allowsEditing: true,
    aspect: [4, 5],
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    quality: 0.9,
    selectionLimit: 10,
    videoMaxDuration: 90
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
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    quality: 0.9,
    selectionLimit: 1,
    videoMaxDuration: 30
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
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    quality: 0.9,
    videoMaxDuration: 90
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
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

export async function listRecentPostImages(limit = 24): Promise<{ assets: RecentPostImage[]; error: string | null }> {
  const permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
  if (!permission.granted) {
    return {
      assets: [],
      error: "Photo library permission was not granted."
    };
  }

  const result = await MediaLibrary.getAssetsAsync({
    first: limit,
    mediaType: MediaLibrary.MediaType.photo,
    sortBy: [MediaLibrary.SortBy.creationTime]
  });

  return {
    assets: result.assets.map((asset) => ({
      id: asset.id,
      uri: asset.uri
    })),
    error: null
  };
}

export async function imageFromRecentAsset(asset: RecentPostImage) {
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
