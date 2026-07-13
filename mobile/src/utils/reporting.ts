import { ActionSheetIOS, Platform } from "react-native";
import type { ReportReason } from "@/services/reports";
import { confirmAction } from "@/utils/confirm";

const IOS_REASONS: Array<{ label: string; reason: ReportReason }> = [
  { label: "Spam or misleading", reason: "spam" },
  { label: "Harassment or bullying", reason: "harassment" },
  { label: "Unsafe or harmful", reason: "unsafe" },
  { label: "Off topic", reason: "off_topic" },
  { label: "Other", reason: "other" }
];

export function chooseReportReason(targetLabel: string): Promise<ReportReason | null> {
  if (Platform.OS === "ios") {
    return new Promise((resolve) => {
      const options = [...IOS_REASONS.map((reason) => reason.label), "Cancel"];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: 0,
          message: "This sends the item to CircleBites moderation.",
          options,
          title: "Report " + targetLabel
        },
        (index) => {
          const selected = IOS_REASONS[index];
          resolve(selected?.reason ?? null);
        }
      );
    });
  }

  return confirmAction({
    title: "Report " + targetLabel + "?",
    message: "This sends the item to CircleBites moderation for review.",
    confirmLabel: "Report",
    destructive: true
  }).then((confirmed) => (confirmed ? "other" : null));
}
