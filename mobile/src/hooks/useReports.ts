import { useMutation } from "@tanstack/react-query";
import { reportContent, type ReportContentInput } from "@/services/reports";

export function useReportContentMutation() {
  return useMutation({
    mutationFn: (input: ReportContentInput) => reportContent(input)
  });
}
