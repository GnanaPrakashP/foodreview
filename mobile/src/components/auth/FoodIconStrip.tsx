import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, useWindowDimensions, View } from "react-native";

const iconColor = "rgba(255, 107, 44, 0.42)";
const accentColor = "rgba(255, 107, 44, 0.36)";

function scaled(baseSize: number, scale: number) {
  return Math.round(baseSize * scale);
}

export function FoodIconStrip() {
  const { width } = useWindowDimensions();
  const scale = Math.min(0.92, Math.max(0.78, (width - 72) / 340));

  return (
    <View pointerEvents="none" style={styles.strip}>
      <View style={styles.accentTopLeft}>
        <Ionicons name="sparkles" size={scaled(15, scale)} color={accentColor} />
      </View>
      <View style={styles.accentHighLeft}>
        <Ionicons name="sparkles" size={scaled(9, scale)} color={accentColor} />
      </View>
      <View style={styles.accentTopMid}>
        <Ionicons name="sparkles" size={scaled(11, scale)} color={accentColor} />
      </View>
      <View style={styles.accentMidOne}>
        <Ionicons name="star" size={scaled(8, scale)} color={accentColor} />
      </View>
      <View style={styles.accentMidTwo}>
        <Ionicons name="sparkles" size={scaled(9, scale)} color={accentColor} />
      </View>
      <View style={styles.accentDrink}>
        <Ionicons name="star" size={scaled(8, scale)} color={accentColor} />
      </View>
      <View style={styles.accentHeart}>
        <Ionicons name="heart" size={scaled(18, scale)} color={accentColor} />
      </View>
      <View style={styles.accentRight}>
        <Ionicons name="sparkles" size={scaled(11, scale)} color={accentColor} />
      </View>

      <View style={styles.mainRow}>
        <MaterialCommunityIcons name="hamburger" size={scaled(44, scale)} color={iconColor} />
        <MaterialCommunityIcons name="noodles" size={scaled(46, scale)} color={iconColor} />
        <MaterialCommunityIcons name="cup-outline" size={scaled(45, scale)} color={iconColor} />
        <MaterialCommunityIcons name="pizza" size={scaled(44, scale)} color={iconColor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    alignItems: "center",
    alignSelf: "stretch",
    height: 86,
    justifyContent: "center",
    marginBottom: 34,
    marginTop: 28,
    maxWidth: 360,
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  mainRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    maxWidth: 320,
    paddingHorizontal: 8,
    width: "100%"
  },
  accentTopLeft: {
    left: "1%",
    position: "absolute",
    top: 26
  },
  accentHighLeft: {
    left: "19%",
    position: "absolute",
    top: 4
  },
  accentTopMid: {
    left: "41%",
    position: "absolute",
    top: 0
  },
  accentMidOne: {
    left: "29%",
    position: "absolute",
    top: 15
  },
  accentMidTwo: {
    left: "48%",
    position: "absolute",
    top: 39
  },
  accentDrink: {
    position: "absolute",
    right: "25%",
    top: 29
  },
  accentHeart: {
    position: "absolute",
    right: "9%",
    top: 3
  },
  accentRight: {
    position: "absolute",
    right: "1%",
    top: 23
  }
});
