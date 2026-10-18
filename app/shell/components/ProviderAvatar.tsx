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

/** The provider's logo on a small tile, or initials when it has no artwork. */
export function ProviderAvatar({
  provider,
  fallbackName,
}: {
  provider: ProviderInfo | undefined;
  fallbackName: string;
}) {
  if (provider !== undefined && (provider.logoUrl !== null || provider.icon !== undefined)) {
    return (
      <span className="lanes-avatar" data-logo="">
        <ProviderIcon providerKind="agent" provider={provider} className="size-3.5" />
      </span>
    );
  }
  return (
    <span className="lanes-avatar" aria-hidden="true">
      {initials(provider?.displayName ?? fallbackName)}
    </span>
  );
}
