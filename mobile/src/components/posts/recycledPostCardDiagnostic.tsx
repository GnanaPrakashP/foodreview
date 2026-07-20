import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

export const RECYCLED_POST_CARD_DIAGNOSTIC_STAGES = [
  "full",
  "media-placeholder",
  "feedback-placeholder",
  "svg-placeholders",
  "text-placeholders",
  "static-geometry",
  "restore-header-fixed-text",
  "restore-header-precomputed-two-line",
  "restore-header-single-line",
  "restore-header",
  "restore-content",
  "restore-media",
  "restore-actions",
  "restore-feedback",
  "stable-svg-identity",
  "single-line-text"
] as const;

export type RecycledPostCardDiagnosticStage =
  typeof RECYCLED_POST_CARD_DIAGNOSTIC_STAGES[number];

export type RecycledPostCardDiagnosticContext = {
  cellId: number;
  enabled: boolean;
  stage: RecycledPostCardDiagnosticStage;
};

export type RecycledPostCardSection =
  | "actions"
  | "avatar"
  | "caption"
  | "dishes"
  | "feedback"
  | "feedback-buttons"
  | "header-metadata"
  | "location"
  | "media"
  | "media-cover"
  | "media-pages"
  | "overflow-controls"
  | "request-control"
  | "restaurant"
  | "tags";

export type RecycledPostCardSectionDescriptor = {
  accessibilityUpdates?: readonly string[];
  branch: string;
  effectUpdates?: readonly string[];
  keys?: readonly string[];
  localStateUpdates?: readonly string[];
  mediaSource?: string | null;
  nativeRoot: string | null;
  svgRoots: number;
  textRoots: number;
};

export type RecycledPostCardDiagnosticPlan = {
  actions: "placeholder" | "real";
  feedback: "placeholder" | "real";
  header: "placeholder" | "real";
  media: "placeholder" | "real";
  content: "placeholder" | "real";
  precomputeHeaderTime: boolean;
  stableSvgIdentity: boolean;
  svgMode: "placeholder" | "real";
  textMode: "placeholder" | "real" | "single-line";
};

type TraceTransition = {
  branch: string;
  branchChanged: boolean;
  effectUpdates: readonly string[];
  fromPostId: string;
  fromBranch: string;
  keyChanged: boolean;
  keys: readonly string[];
  localStateUpdates: readonly string[];
  mediaSource: string | null;
  nativeRootChanged: boolean;
  postId: string;
  svgRoots: number;
  textRoots: number;
};

type TraceEntry = {
  assignmentEffectCleanups: number;
  assignmentEffects: number;
  branchChanges: number;
  commits: number;
  instanceId: number;
  keyChanges: number;
  mounts: number;
  nativeRootChanges: number;
  postIds: Set<string>;
  rebinds: number;
  renders: number;
  section: RecycledPostCardSection;
  transitions: TraceTransition[];
  unmounts: number;
};

const traceEntries = new Map<string, TraceEntry>();
let nextTraceInstanceId = 1;
let traceWindow = 0;

function traceEntryKey(cellId: number, section: RecycledPostCardSection, instanceId: number) {
  return `${cellId}:${section}:${instanceId}`;
}

function createTraceEntry(section: RecycledPostCardSection, instanceId: number): TraceEntry {
  return {
    assignmentEffectCleanups: 0,
    assignmentEffects: 0,
    branchChanges: 0,
    commits: 0,
    instanceId,
    keyChanges: 0,
    mounts: 0,
    nativeRootChanges: 0,
    postIds: new Set<string>(),
    rebinds: 0,
    renders: 0,
    section,
    transitions: [],
    unmounts: 0
  };
}

function arraysEqual(first: readonly string[] | undefined, second: readonly string[] | undefined) {
  if (first === second) return true;
  if (!first || !second || first.length !== second.length) return false;
  return first.every((value, index) => value === second[index]);
}

export function isRecycledPostCardDiagnosticStage(
  value: string | undefined
): value is RecycledPostCardDiagnosticStage {
  return RECYCLED_POST_CARD_DIAGNOSTIC_STAGES.some((stage) => stage === value);
}

export function recycledPostCardDiagnosticPlan(
  stage: RecycledPostCardDiagnosticStage
): RecycledPostCardDiagnosticPlan {
  const allReal: RecycledPostCardDiagnosticPlan = {
    actions: "real",
    content: "real",
    feedback: "real",
    header: "real",
    media: "real",
    precomputeHeaderTime: false,
    stableSvgIdentity: false,
    svgMode: "real",
    textMode: "real"
  };
  if (stage === "full") return allReal;
  if (stage === "media-placeholder") return { ...allReal, media: "placeholder" };
  if (stage === "feedback-placeholder") return { ...allReal, feedback: "placeholder" };
  if (stage === "svg-placeholders") return { ...allReal, svgMode: "placeholder" };
  if (stage === "text-placeholders") return { ...allReal, textMode: "placeholder" };
  if (stage === "stable-svg-identity") return { ...allReal, stableSvgIdentity: true };
  if (stage === "single-line-text") return { ...allReal, textMode: "single-line" };

  const staticPlan: RecycledPostCardDiagnosticPlan = {
    actions: "placeholder",
    content: "placeholder",
    feedback: "placeholder",
    header: "placeholder",
    media: "placeholder",
    precomputeHeaderTime: false,
    stableSvgIdentity: false,
    svgMode: "placeholder",
    textMode: "placeholder"
  };
  if (stage === "static-geometry") return staticPlan;
  if (stage === "restore-header-fixed-text") {
    return { ...staticPlan, header: "real", svgMode: "real", textMode: "placeholder" };
  }
  if (stage === "restore-header-precomputed-two-line") {
    return { ...staticPlan, header: "real", precomputeHeaderTime: true, svgMode: "real", textMode: "real" };
  }
  if (stage === "restore-header-single-line") {
    return {
      ...staticPlan,
      header: "real",
      precomputeHeaderTime: true,
      svgMode: "real",
      textMode: "single-line"
    };
  }
  if (stage === "restore-header") {
    return { ...staticPlan, header: "real", svgMode: "real", textMode: "real" };
  }
  if (stage === "restore-content") {
    return {
      ...staticPlan,
      content: "real",
      header: "real",
      svgMode: "real",
      textMode: "real"
    };
  }
  if (stage === "restore-media") {
    return {
      ...staticPlan,
      content: "real",
      header: "real",
      media: "real",
      svgMode: "real",
      textMode: "real"
    };
  }
  if (stage === "restore-actions") {
    return {
      ...staticPlan,
      actions: "real",
      content: "real",
      header: "real",
      media: "real",
      svgMode: "real",
      textMode: "real"
    };
  }
  return allReal;
}

export function beginRecycledPostCardTraceWindow(stage: RecycledPostCardDiagnosticStage) {
  if (!__DEV__) return;
  traceWindow += 1;
  for (const entry of traceEntries.values()) {
    entry.assignmentEffectCleanups = 0;
    entry.assignmentEffects = 0;
    entry.branchChanges = 0;
    entry.commits = 0;
    entry.keyChanges = 0;
    entry.mounts = 0;
    entry.nativeRootChanges = 0;
    entry.postIds.clear();
    entry.rebinds = 0;
    entry.renders = 0;
    entry.transitions = [];
    entry.unmounts = 0;
  }
  console.info(`CB_HOME_RECYCLED_SUBTREE_TRACE_BEGIN ${JSON.stringify({ stage, traceWindow })}`);
}

export function finishRecycledPostCardTraceWindow(stage: RecycledPostCardDiagnosticStage) {
  if (!__DEV__) return;
  const sections = [...traceEntries.values()]
    .map((entry) => ({
      assignmentEffectCleanups: entry.assignmentEffectCleanups,
      assignmentEffects: entry.assignmentEffects,
      branchChanges: entry.branchChanges,
      commits: entry.commits,
      instanceId: entry.instanceId,
      keyChanges: entry.keyChanges,
      mounts: entry.mounts,
      nativeRootChanges: entry.nativeRootChanges,
      postIds: [...entry.postIds],
      rebinds: entry.rebinds,
      renders: entry.renders,
      section: entry.section,
      transitions: entry.transitions,
      unmounts: entry.unmounts
    }))
    .sort((first, second) => first.section.localeCompare(second.section));
  console.info(`CB_HOME_RECYCLED_SUBTREE_TRACE_SETTLED ${JSON.stringify({
    sections,
    stage,
    traceWindow
  })}`);
}

export function RecycledPostCardSectionTrace({
  children,
  context,
  descriptor,
  postId,
  section
}: {
  children: ReactNode;
  context: RecycledPostCardDiagnosticContext;
  descriptor: RecycledPostCardSectionDescriptor;
  postId: string;
  section: RecycledPostCardSection;
}) {
  const instanceIdRef = useRef<number | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = nextTraceInstanceId;
    nextTraceInstanceId += 1;
  }
  const instanceId = instanceIdRef.current;
  const entryKey = traceEntryKey(context.cellId, section, instanceId);
  let entry = traceEntries.get(entryKey);
  if (!entry) {
    entry = createTraceEntry(section, instanceId);
    traceEntries.set(entryKey, entry);
  }
  const previousPostIdRef = useRef<string | null>(null);
  const previousDescriptorRef = useRef<RecycledPostCardSectionDescriptor | null>(null);

  if (context.enabled) {
    entry.renders += 1;
    entry.postIds.add(postId);
    const previousPostId = previousPostIdRef.current;
    const previousDescriptor = previousDescriptorRef.current;
    if (previousPostId && previousPostId !== postId && previousDescriptor) {
      const branchChanged = previousDescriptor.branch !== descriptor.branch;
      const keyChanged = !arraysEqual(previousDescriptor.keys, descriptor.keys);
      const nativeRootChanged = previousDescriptor.nativeRoot !== descriptor.nativeRoot;
      entry.rebinds += 1;
      entry.branchChanges += branchChanged ? 1 : 0;
      entry.keyChanges += keyChanged ? 1 : 0;
      entry.nativeRootChanges += nativeRootChanged ? 1 : 0;
      entry.transitions.push({
        branch: descriptor.branch,
        branchChanged,
        effectUpdates: descriptor.effectUpdates ?? [],
        fromPostId: previousPostId,
        fromBranch: previousDescriptor.branch,
        keyChanged,
        keys: descriptor.keys ?? [],
        localStateUpdates: descriptor.localStateUpdates ?? [],
        mediaSource: descriptor.mediaSource ?? null,
        nativeRootChanged,
        postId,
        svgRoots: descriptor.svgRoots,
        textRoots: descriptor.textRoots
      });
    }
  }
  previousPostIdRef.current = postId;
  previousDescriptorRef.current = descriptor;

  useLayoutEffect(() => {
    if (!context.enabled) return;
    entry.commits += 1;
  });

  useEffect(() => {
    if (!context.enabled) return;
    entry.mounts += 1;
    return () => {
      entry.unmounts += 1;
    };
  }, [context.cellId, context.enabled, entry, instanceId, section]);

  useEffect(() => {
    if (!context.enabled) return;
    entry.assignmentEffects += 1;
    return () => {
      entry.assignmentEffectCleanups += 1;
    };
  }, [context.enabled, entry, postId]);

  return children;
}
