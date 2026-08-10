import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_400Regular_Italic } from "@expo-google-fonts/dm-sans/400Regular_Italic";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { DMSans_600SemiBold_Italic } from "@expo-google-fonts/dm-sans/600SemiBold_Italic";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { DMSans_800ExtraBold } from "@expo-google-fonts/dm-sans/800ExtraBold";
import { useFonts } from "expo-font";

export const fontFamilies = {
  regular: "DMSans_400Regular",
  regularItalic: "DMSans_400Regular_Italic",
  medium: "DMSans_500Medium",
  semiBold: "DMSans_600SemiBold",
  semiBoldItalic: "DMSans_600SemiBold_Italic",
  bold: "DMSans_700Bold",
  extraBold: "DMSans_800ExtraBold"
} as const;

export const fontStyles = {
  regular: {
    fontFamily: fontFamilies.regular
  },
  regularItalic: {
    fontFamily: fontFamilies.regularItalic
  },
  medium: {
    fontFamily: fontFamilies.medium
  },
  semiBold: {
    fontFamily: fontFamilies.semiBold
  },
  semiBoldItalic: {
    fontFamily: fontFamilies.semiBoldItalic
  },
  bold: {
    fontFamily: fontFamilies.bold
  },
  extraBold: {
    fontFamily: fontFamilies.extraBold
  }
} as const;

export function useWitohFonts() {
  return useFonts({
    [fontFamilies.regular]: DMSans_400Regular,
    [fontFamilies.regularItalic]: DMSans_400Regular_Italic,
    [fontFamilies.medium]: DMSans_500Medium,
    [fontFamilies.semiBold]: DMSans_600SemiBold,
    [fontFamilies.semiBoldItalic]: DMSans_600SemiBold_Italic,
    [fontFamilies.bold]: DMSans_700Bold,
    [fontFamilies.extraBold]: DMSans_800ExtraBold
  });
}
