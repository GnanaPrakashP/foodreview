import * as ImagePicker from "expo-image-picker";

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

export const pickPostMediaPlaceholder = pickPostImageFromGallery;
