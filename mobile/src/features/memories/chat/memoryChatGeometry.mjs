export const MEMORY_CHAT_GEOMETRY_VERSION = 1;

const BASE_CONTRACT = Object.freeze({
  actionButtonSize: 40,
  closedSafeGap: 6,
  edgeToEdgeBottomGap: 20,
  inputBorderHeight: 2,
  inputFontSize: 15,
  inputLineHeight: 21,
  inputVerticalPadding: 18,
  standardBottomGap: 12,
  toolbarBorderWidth: 1,
  toolbarPaddingTop: 7
});

function finiteNonNegative(value, fallback) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

function roundToPhysicalPixel(value, pixelRatio) {
  const ratio = Math.max(1, finiteNonNegative(pixelRatio, 1));
  return Math.round(value * ratio) / ratio;
}

export function memoryChatComposerLayoutContract(platform) {
  if (platform === "web") {
    return Object.freeze({
      ...BASE_CONTRACT,
      actionButtonSize: 36,
      inputFontSize: 14,
      inputLineHeight: 20,
      inputVerticalPadding: 16
    });
  }
  if (platform === "ios") {
    return Object.freeze({
      ...BASE_CONTRACT,
      inputVerticalPadding: 20
    });
  }
  return BASE_CONTRACT;
}

/**
 * Canonical closed-composer geometry.
 *
 * The same result owns the first list spacer, toolbar bottom padding and native
 * keyboard host's closed gap. Runtime onLayout may validate this model, but it
 * must not replace the active collapsed clearance and move visible rows.
 */
export function resolveMemoryChatCollapsedComposerGeometry({
  bottomSafeAreaInset,
  fontScale,
  isEdgeToEdge,
  pixelRatio,
  platform
}) {
  const contract = memoryChatComposerLayoutContract(platform);
  const safeAreaInset = finiteNonNegative(bottomSafeAreaInset, 0);
  const resolvedFontScale = Math.max(1, finiteNonNegative(fontScale, 1));
  const resolvedPixelRatio = Math.max(1, finiteNonNegative(pixelRatio, 1));
  const fallbackBottomGap = isEdgeToEdge
    ? contract.edgeToEdgeBottomGap
    : contract.standardBottomGap;
  const closedBottomPadding = Math.max(
    safeAreaInset + contract.closedSafeGap,
    fallbackBottomGap
  );

  // Android's native input receives this exact minimum. At ordinary font scale
  // the existing fixed minimum wins; at accessibility scales the deterministic
  // glyph allowance grows before Chat mounts instead of waiting for a native
  // height event to correct the initial list.
  const scaledGlyphLineHeight = Math.max(
    contract.inputLineHeight,
    contract.inputFontSize * resolvedFontScale * 1.2
  );
  const fixedMinimumMessageBoxHeight = Math.max(
    platform === "web" ? 0 : 42,
    contract.inputLineHeight +
      contract.inputVerticalPadding +
      contract.inputBorderHeight
  );
  const messageBoxHeight = Math.max(
    fixedMinimumMessageBoxHeight,
    roundToPhysicalPixel(
      scaledGlyphLineHeight +
        contract.inputVerticalPadding +
        contract.inputBorderHeight,
      resolvedPixelRatio
    )
  );
  const fixedAccessoryHeight = Math.max(
    messageBoxHeight,
    contract.actionButtonSize
  );
  const composerHeight = roundToPhysicalPixel(
    contract.toolbarBorderWidth +
      contract.toolbarPaddingTop +
      fixedAccessoryHeight +
      closedBottomPadding,
    resolvedPixelRatio
  );

  return Object.freeze({
    closedBottomPadding,
    composerHeight,
    fontScale: resolvedFontScale,
    listClearance: composerHeight,
    messageBoxHeight,
    pixelRatio: resolvedPixelRatio,
    safeAreaInset,
    version: MEMORY_CHAT_GEOMETRY_VERSION
  });
}

const DM_SANS_SEMIBOLD_UNITS_PER_EM = 1000;
const DM_SANS_SEMIBOLD_TIMESTAMP_ADVANCES = Object.freeze({
  "0": 698,
  "1": 348,
  "2": 577,
  "3": 599,
  "4": 638,
  "5": 618,
  "6": 618,
  "7": 526,
  "8": 600,
  "9": 633,
  ":": 239,
  " ": 244,
  "\u00a0": 244,
  "\u202f": 122,
  a: 574,
  m: 926,
  p: 646,
  A: 696,
  M: 873,
  P: 604
});
const DM_SANS_SEMIBOLD_FALLBACK_ADVANCE = 600;

/**
 * Returns the first-frame inline reservation for the pinned timestamp.
 *
 * The advances are the bundled DMSans_600SemiBold font's source metrics. The
 * visible timestamp uses that same font, so this preserves its natural width
 * plus the established fixed gap without rendering a duplicate label or
 * waiting for an onLayout measurement.
 */
export function memoryChatTimestampReservationWidth(
  label,
  {
    fontScale = 1,
    fontSize = 11,
    gap = 8
  } = {}
) {
  const normalized = typeof label === "string" ? label.trim() : "";
  const resolvedFontScale =
    typeof fontScale === "number" && Number.isFinite(fontScale) && fontScale > 0
      ? fontScale
      : 1;
  const resolvedFontSize =
    typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize > 0
      ? fontSize
      : 11;
  const resolvedGap =
    typeof gap === "number" && Number.isFinite(gap) && gap >= 0
      ? gap
      : 8;
  const advanceUnits = Array.from(normalized).reduce(
    (total, character) =>
      total +
      (DM_SANS_SEMIBOLD_TIMESTAMP_ADVANCES[character] ??
        DM_SANS_SEMIBOLD_FALLBACK_ADVANCE),
    0
  );

  return (
    Math.ceil(
      (advanceUnits / DM_SANS_SEMIBOLD_UNITS_PER_EM) *
        resolvedFontSize *
        resolvedFontScale
    ) + resolvedGap
  );
}
