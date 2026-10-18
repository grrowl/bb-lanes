import { experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import type { ProviderInfo } from "../data/useLanesData";

export function initials(name: string): string {
  const letters = name
    .split(/[\s\-_/]+/u)
    .filter((word) => word !== "")
    .map((word) => word[0] ?? "")
    .join("");
  return (letters || "?").slice(0, 2).toUpperCase();
}

/**
 * The provider's logo on a small white tile, or initials on a quiet disc
 * when it has no artwork. `small` is the bare 14px logo, for group rows.
 */
export function ProviderAvatar({
  provider,
  fallbackName,
  size = "lane",
}: {
  provider: ProviderInfo | undefined;
  fallbackName: string;
  size?: "lane" | "small";
}) {
  const hasLogo = provider !== undefined && (provider.logoUrl !== null || provider.icon !== undefined);
  if (size === "small") {
    return hasLogo ? <ProviderIcon providerKind="agent" provider={provider} /> : null;
  }
  if (hasLogo) {
    return (
      <span className="lanes-avatar" data-logo="">
        <ProviderIcon providerKind="agent" provider={provider} />
      </span>
    );
  }
  return (
    <span className="lanes-avatar" aria-hidden="true">
      {initials(provider?.displayName ?? fallbackName)}
    </span>
  );
}
