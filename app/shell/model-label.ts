// Model ids arrive raw from the turn requests ("claude-opus-5-5",
// "gpt-6.1-sol"). Lanes shows them the way people say them ("Opus 5.5",
// "GPT-6.1 Sol"), so the subtitle stays short and reads like the composer's
// picker.

const ACRONYMS = new Set(["gpt", "glm", "oss", "xl"]);
const DROPPED_PREFIXES = new Set(["claude"]);

export function formatModelLabel(modelId: string): string {
  const trimmed = modelId
    .trim()
    // Context-window and date suffixes: "[1m]", "-20260101", "@2026-01-01".
    .replace(/\[[^\]]*\]$/u, "")
    .replace(/[-@]\d{8}$/u, "")
    .replace(/@\d{4}-\d{2}-\d{2}$/u, "");
  // Vendor prefixes in a path: "anthropic/claude-opus-5-5".
  const base = trimmed.split("/").pop() ?? trimmed;
  if (base === "") return modelId;

  const words: string[] = [];
  for (const token of base.split(/[-_\s]+/u)) {
    if (token === "") continue;
    const previous = words[words.length - 1];
    // Version digits split by dashes ("5-5") become dotted ("5.5").
    if (/^\d+$/u.test(token) && previous !== undefined && /\d$/u.test(previous)) {
      words[words.length - 1] = `${previous}.${token}`;
      continue;
    }
    // "gpt" + "6.1" reads as "GPT-6.1".
    if (/^\d/u.test(token) && previous !== undefined && ACRONYMS.has(previous.toLowerCase())) {
      words[words.length - 1] = `${previous}-${token}`;
      continue;
    }
    words.push(token);
  }

  const shown = words
    .filter((word, index) => !(index === 0 && words.length > 1 && DROPPED_PREFIXES.has(word.toLowerCase())))
    .map((word) => {
      const [head = "", ...rest] = word.split("-");
      const cased = ACRONYMS.has(head.toLowerCase())
        ? head.toUpperCase()
        : /^\d/u.test(head)
          ? head
          : head.charAt(0).toUpperCase() + head.slice(1);
      return [cased, ...rest].join("-");
    });
  return shown.join(" ");
}
