import { Image } from "expo-image";
import { StyleSheet, useWindowDimensions, View } from "react-native";

const heroSource = require("../../../assets/onboarding/food-decision-hero.webp");

function heroHeightForWidth(width: number) {
  const proportionalHeight = Math.round(width * (1024 / 1536));
  if (width >= 768) return Math.min(320, proportionalHeight);
  if (width >= 430) return Math.min(288, proportionalHeight);
  return Math.max(238, Math.min(270, proportionalHeight));
}

export function LoginHeroIllustration() {
  const { width } = useWindowDimensions();
  const height = heroHeightForWidth(width);

  return (
    <View style={[styles.wrap, { height, width }]}>
      <Image
        accessibilityIgnoresInvertColors
        contentFit="contain"
        source={heroSource}
        style={styles.image}
        transition={180}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "transparent",
    justifyContent: "flex-start",
    marginBottom: -28,
    overflow: "hidden",
    width: "100%"
  },
  image: {
    height: "100%",
    width: "100%"
  }
});
