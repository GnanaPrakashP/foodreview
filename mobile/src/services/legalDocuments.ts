import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { publicWebBaseUrl } from "@/api/config";

export type LegalDocument = "privacy" | "terms";

const CANONICAL_WEB_BASE_URL = "https://www.circlebites.in";
const legalWebBaseUrl = (publicWebBaseUrl || CANONICAL_WEB_BASE_URL).replace(/\/$/, "");

export const LEGAL_DOCUMENT_URLS: Readonly<Record<LegalDocument, string>> = Object.freeze({
  privacy: `${legalWebBaseUrl}/privacy`,
  terms: `${legalWebBaseUrl}/terms`
});

/**
 * Opens the canonical public policy in an in-app browser. The external HTTPS
 * handler is a fallback for devices where the browser sheet is unavailable.
 */
export async function openLegalDocument(document: LegalDocument) {
  const url = LEGAL_DOCUMENT_URLS[document];

  try {
    await WebBrowser.openBrowserAsync(url, {
      dismissButtonStyle: "close",
      enableBarCollapsing: true,
      showTitle: true
    });
  } catch (inAppBrowserError) {
    try {
      await Linking.openURL(url);
    } catch {
      throw inAppBrowserError;
    }
  }
}
