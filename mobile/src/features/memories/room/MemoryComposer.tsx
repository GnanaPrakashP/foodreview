import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputContentSizeChangeEventData,
  View,
  type ViewStyle
} from "react-native";
import Reanimated from "react-native-reanimated";
import { MEMORY_TEXT_MAX_LENGTH } from "@/constants/memoryLimits";
import type { OccasionTheme } from "@/features/occasions/occasionThemes";
import { fontStyles, radius, spacing } from "@/theme";
import type { MemoryMessage } from "@/types/models";

const ROOM_MAX_WIDTH = 640;
const COMPOSER_TOP_GAP = 8;
const COMPOSER_INPUT_FONT_SIZE = Platform.OS === "web" ? 14 : 15;
const COMPOSER_INPUT_LINE_HEIGHT = Platform.OS === "web" ? 20 : 21;
const COMPOSER_INPUT_VERTICAL_PADDING = 12;
const COMPOSER_INPUT_MIN_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT + COMPOSER_INPUT_VERTICAL_PADDING;
const COMPOSER_INPUT_MAX_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT * 5 + COMPOSER_INPUT_VERTICAL_PADDING;
const COMPOSER_MESSAGE_BOX_MIN_HEIGHT = Platform.OS === "web" ? 38 : 42;
const COMPOSER_ACTION_BUTTON_SIZE = Platform.OS === "web" ? 36 : 40;

type MemoryComposerColors = {
  border: string;
  borderStrong: string;
  cool: string;
  coolBorder: string;
  coolDim: string;
  danger: string;
  glassDim: string;
  muted: string;
  onCool: string;
  onSurface: string;
  panel: string;
  panelRaised: string;
};

export type MemoryComposerProps = {
  colors: MemoryComposerColors;
  editingLabel?: string;
  insetStyle: StyleProp<ViewStyle>;
  inputRef: RefObject<TextInput | null>;
  mediaError?: string;
  mediaMutationError?: string;
  mediaPending: boolean;
  message: string;
  messageError?: string;
  messagePending: boolean;
  onCancelEdit?: () => void;
  onCancelReply?: () => void;
  onChangeMessage: (value: string) => void;
  onInputFocus: () => void;
  onLayoutChange: (event: LayoutChangeEvent) => void;
  onSend: (message: string) => void;
  replyingToMessage?: MemoryMessage | null;
  themeCopy: OccasionTheme["copy"];
};

function memoryMessageReplyPreview(message: Pick<MemoryMessage, "attachments" | "body">) {
  const body = message.body.trim();
  if (body) return body;
  return message.attachments.length > 0 ? "Media" : "Message";
}

export function MemoryComposer({
  colors,
  editingLabel,
  insetStyle,
  inputRef,
  mediaError,
  mediaMutationError,
  mediaPending,
  message,
  messageError,
  messagePending,
  onCancelEdit,
  onCancelReply,
  onChangeMessage,
  onInputFocus,
  onLayoutChange,
  replyingToMessage,
  onSend,
  themeCopy
}: MemoryComposerProps) {
  const styles = useMemo(() => createMemoryComposerStyles(colors), [colors]);
  const canSend = Boolean(message.trim()) && !messagePending && !mediaPending;
  const draftRef = useRef(message);
  const [composerInputHeight, setComposerInputHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT);
  const composerCanScroll = composerInputHeight >= COMPOSER_INPUT_MAX_HEIGHT;

  useEffect(() => {
    draftRef.current = message;
  }, [message]);

  useEffect(() => {
    if (message.length === 0 && composerInputHeight !== COMPOSER_INPUT_MIN_HEIGHT) {
      setComposerInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
    }
  }, [composerInputHeight, message]);

  function handleChangeMessage(value: string) {
    draftRef.current = value;
    onChangeMessage(value);
  }

  function handleSendPress() {
    const outgoingDraft = draftRef.current;
    if (!outgoingDraft.trim() || messagePending || mediaPending) return;
    if (!editingLabel) draftRef.current = "";
    onSend(outgoingDraft);
  }

  function handleComposerContentSizeChange(event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) {
    const nextHeight = Math.max(
      COMPOSER_INPUT_MIN_HEIGHT,
      Math.min(COMPOSER_INPUT_MAX_HEIGHT, Math.ceil(event.nativeEvent.contentSize.height))
    );
    setComposerInputHeight(nextHeight);
  }

  return (
    <Reanimated.View style={[styles.composerWrap, insetStyle]}>
      <View onLayout={onLayoutChange} style={styles.composerContent}>
        {messageError || mediaError || mediaMutationError ? (
          <Text style={styles.error}>{messageError || mediaError || mediaMutationError}</Text>
        ) : null}
        {editingLabel ? (
          <View style={styles.editingBanner}>
            <Text style={styles.editingBannerText}>{editingLabel}</Text>
            <Pressable hitSlop={8} onPress={onCancelEdit}>
              <Text style={styles.editingCancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        {!editingLabel && replyingToMessage ? (
          <View style={styles.replyComposerBanner}>
            <View style={styles.replyComposerAccent} />
            <View style={styles.replyComposerIcon}>
              <Ionicons name="arrow-undo-outline" size={14} color={colors.cool} />
            </View>
            <View style={styles.replyComposerCopy}>
              <Text numberOfLines={1} style={styles.replyComposerLabel}>{replyingToMessage.authorDisplayName}</Text>
              <Text numberOfLines={2} style={styles.replyComposerPreview}>
                {memoryMessageReplyPreview(replyingToMessage)}
              </Text>
            </View>
            <Pressable accessibilityLabel="Cancel reply" hitSlop={8} onPress={onCancelReply} style={styles.replyComposerClose}>
              <Ionicons name="close" size={15} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composer}>
          <View style={styles.messageBox}>
            <TextInput
              maxLength={MEMORY_TEXT_MAX_LENGTH}
              multiline
              onContentSizeChange={handleComposerContentSizeChange}
              onChangeText={handleChangeMessage}
              onFocus={onInputFocus}
              placeholder={themeCopy.composerPlaceholder}
              placeholderTextColor={colors.muted}
              scrollEnabled={composerCanScroll}
              style={[
                styles.composerInput,
                Platform.OS === "web" ? styles.composerInputWeb : styles.composerInputNative,
                { height: composerInputHeight }
              ]}
              ref={inputRef}
              value={message}
            />
          </View>
          <Pressable
            accessibilityLabel={editingLabel ? "Save message" : "Send message"}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={handleSendPress}
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          >
            <Ionicons name={editingLabel ? "checkmark" : "send"} size={Platform.OS === "web" ? 15 : 17} color={colors.onCool} />
          </Pressable>
        </View>
      </View>
    </Reanimated.View>
  );
}

function createMemoryComposerStyles(colors: MemoryComposerColors) {
  return StyleSheet.create({
    composerWrap: {
      alignSelf: "center",
      backgroundColor: "transparent",
      borderLeftColor: Platform.OS === "web" ? colors.border : "transparent",
      borderLeftWidth: Platform.OS === "web" ? 1 : 0,
      borderRightColor: Platform.OS === "web" ? colors.border : "transparent",
      borderRightWidth: Platform.OS === "web" ? 1 : 0,
      borderTopColor: colors.border,
      borderTopWidth: 0,
      maxWidth: ROOM_MAX_WIDTH,
      paddingHorizontal: Platform.OS === "web" ? spacing.md : spacing.lg,
      width: "100%"
    },
    composerContent: {
      gap: 6,
      paddingTop: COMPOSER_TOP_GAP,
      position: "relative"
    },
    composer: {
      alignItems: "flex-end",
      flexDirection: "row",
      gap: spacing.sm
    },
    editingBanner: {
      alignItems: "center",
      backgroundColor: colors.panel,
      borderColor: colors.border,
      borderRadius: radius.input,
      borderWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: 8
    },
    editingBannerText: {
      ...fontStyles.extraBold,
      color: colors.onSurface,
      fontSize: 12,
      lineHeight: 15
    },
    editingCancelText: {
      ...fontStyles.extraBold,
      color: colors.cool,
      fontSize: 12,
      lineHeight: 15
    },
    replyComposerBanner: {
      alignItems: "center",
      backgroundColor: colors.panel,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: "row",
      gap: 9,
      marginHorizontal: -2,
      minHeight: 54,
      overflow: "hidden",
      paddingHorizontal: 10,
      paddingVertical: 9
    },
    replyComposerAccent: {
      alignSelf: "stretch",
      backgroundColor: colors.cool,
      borderRadius: radius.pill,
      width: 3
    },
    replyComposerIcon: {
      alignItems: "center",
      backgroundColor: colors.coolDim,
      borderColor: colors.coolBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      height: 28,
      justifyContent: "center",
      width: 28
    },
    replyComposerCopy: {
      flex: 1,
      minWidth: 0
    },
    replyComposerLabel: {
      ...fontStyles.extraBold,
      color: colors.cool,
      fontSize: 12,
      lineHeight: 15
    },
    replyComposerPreview: {
      ...fontStyles.semiBold,
      color: colors.muted,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 2
    },
    replyComposerClose: {
      alignItems: "center",
      backgroundColor: colors.glassDim,
      borderRadius: radius.pill,
      height: 30,
      justifyContent: "center",
      width: 30
    },
    messageBox: {
      alignItems: "flex-end",
      backgroundColor: colors.panelRaised,
      borderColor: colors.borderStrong,
      borderRadius: 16,
      borderWidth: 1,
      flex: 1,
      flexDirection: "row",
      minHeight: COMPOSER_MESSAGE_BOX_MIN_HEIGHT,
      paddingHorizontal: Platform.OS === "web" ? 12 : 13,
      paddingVertical: Platform.OS === "web" ? 2 : 3
    },
    composerInput: {
      ...fontStyles.medium,
      color: colors.onSurface,
      flex: 1,
      fontSize: COMPOSER_INPUT_FONT_SIZE,
      includeFontPadding: false,
      lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
      maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
      paddingHorizontal: 2,
      textAlignVertical: "top"
    },
    composerInputNative: {
      paddingBottom: 6,
      paddingTop: 6
    },
    composerInputWeb: {
      paddingBottom: 6,
      paddingTop: 6
    },
    sendButton: {
      alignItems: "center",
      backgroundColor: colors.cool,
      borderRadius: radius.pill,
      height: COMPOSER_ACTION_BUTTON_SIZE,
      justifyContent: "center",
      width: COMPOSER_ACTION_BUTTON_SIZE
    },
    sendButtonDisabled: {
      opacity: 0.45
    },
    error: {
      ...fontStyles.regular,
      color: colors.danger,
      fontSize: 12,
      lineHeight: 17
    }
  });
}
