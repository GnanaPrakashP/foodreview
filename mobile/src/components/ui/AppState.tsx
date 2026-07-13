import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppText } from "@/components/ui/AppText";
import { useThemePreference } from "@/hooks/useThemePreference";
import { radius, spacing } from "@/theme";

type StateProps = {
  actionLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  message?: string;
  onAction?: () => void;
  title: string;
};

function StateShell({ actionLabel, icon, message, onAction, title, loading }: StateProps & { loading?: boolean }) {
  const { themeColors } = useThemePreference();
  return (
    <AppCard accessibilityLiveRegion={loading ? "polite" : "assertive"} style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: themeColors.orangeDim }]}>
        {loading ? (
          <ActivityIndicator color={themeColors.orange} />
        ) : icon ? (
          <Ionicons name={icon} size={24} color={themeColors.orange} />
        ) : null}
      </View>
      <AppText variant="section" style={styles.centered}>
        {title}
      </AppText>
      {message ? (
        <AppText tone="muted" variant="muted" style={styles.centered}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <AppButton onPress={onAction}>{actionLabel}</AppButton> : null}
    </AppCard>
  );
}

export function LoadingState({ message = "Loading...", title = "Loading" }: Partial<StateProps>) {
  return <StateShell loading title={title} message={message} />;
}

export function ErrorState({ actionLabel, message, onAction, title = "Something went wrong" }: Partial<StateProps>) {
  return (
    <StateShell
      actionLabel={actionLabel}
      icon="warning-outline"
      message={message}
      onAction={onAction}
      title={title}
    />
  );
}

export function EmptyState({ actionLabel, icon = "restaurant-outline", message, onAction, title }: StateProps) {
  return (
    <StateShell
      actionLabel={actionLabel}
      icon={icon}
      message={message}
      onAction={onAction}
      title={title}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: spacing.md
  },
  iconWrap: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 52,
    justifyContent: "center",
    width: 52
  },
  centered: {
    textAlign: "center"
  }
});
