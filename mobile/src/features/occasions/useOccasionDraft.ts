import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyOccasion } from "./classifyOccasion";
import { getOccasionTheme } from "./occasionThemes";
import { loadOccasionCorrections, saveOccasionCorrection } from "./occasionStorage";
import type { OccasionClassification, OccasionCorrection, OccasionType } from "./occasionTypes";

export type OccasionDraftState = {
  classifyCurrent: () => OccasionClassification;
  classification: OccasionClassification;
  confirmedByUser: boolean;
  confirmOccasion: (type: OccasionType) => void;
  effectiveThemeType: OccasionType;
  resetConfirmation: () => void;
  themeKey: string;
};

export function useOccasionDraft({
  participantCount,
  title,
  userId
}: {
  participantCount?: number;
  title: string;
  userId?: string | null;
}): OccasionDraftState {
  const [corrections, setCorrections] = useState<OccasionCorrection[]>([]);
  const [confirmedType, setConfirmedType] = useState<OccasionType | null>(null);
  const [classifiedTitle, setClassifiedTitle] = useState(title);
  const previousTitleRef = useRef(title);

  useEffect(() => {
    let active = true;
    loadOccasionCorrections(userId).then((saved) => {
      if (active) setCorrections(saved);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (title === previousTitleRef.current) return;
    previousTitleRef.current = title;
    setConfirmedType(null);
  }, [title]);

  useEffect(() => {
    const timeout = setTimeout(() => setClassifiedTitle(title), 350);
    return () => clearTimeout(timeout);
  }, [title]);

  const classifyCurrent = useCallback(() => (
    classifyOccasion(title, {
      explicitOccasion: confirmedType ?? undefined,
      participantCount,
      savedCorrections: corrections
    })
  ), [confirmedType, corrections, participantCount, title]);

  const classification = useMemo(() => (
    classifyOccasion(classifiedTitle, {
      explicitOccasion: confirmedType ?? undefined,
      participantCount,
      savedCorrections: corrections
    })
  ), [classifiedTitle, confirmedType, corrections, participantCount]);

  const confirmedByUser = Boolean(confirmedType);
  const effectiveThemeType: OccasionType = confirmedByUser || classification.confidence >= 0.85
    ? classification.type
    : "unknown";
  const themeKey = getOccasionTheme(effectiveThemeType).id;

  const confirmOccasion = useCallback((type: OccasionType) => {
    setConfirmedType(type);
    void saveOccasionCorrection({ phrase: title, type, userId });
  }, [title, userId]);

  const resetConfirmation = useCallback(() => {
    setConfirmedType(null);
  }, []);

  return {
    classifyCurrent,
    classification,
    confirmedByUser,
    confirmOccasion,
    effectiveThemeType,
    resetConfirmation,
    themeKey
  };
}
