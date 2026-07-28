const maximumExcerptCharacters = 120;
const maximumWindowCharacters = 320;
const emptyExcerpt = "(no request recorded)";
const controlMarkers = /\[(?:control|bidi):U\+[0-9A-F]{4}\]/gu;

export const sessionRowExcerpt = (value: string | undefined): string => {
  if (value === undefined) return emptyExcerpt;
  const flattened = value.replaceAll(controlMarkers, " ").replaceAll(/\s+/gu, " ").trim();
  if (flattened.length === 0) return emptyExcerpt;
  const characters = Array.from(flattened);
  if (characters.length <= maximumExcerptCharacters) return flattened;
  const clipped = characters.slice(0, maximumExcerptCharacters - 1).join("");
  const lastSpace = clipped.lastIndexOf(" ");
  const body = lastSpace > maximumExcerptCharacters - 30 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
};

export const findingWindow = (text: string, marker: string): string => {
  const characters = Array.from(text);
  if (characters.length <= maximumWindowCharacters) return text;
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return `${characters.slice(0, maximumWindowCharacters - 1).join("")}…`;
  const markerLength = Array.from(marker).length;
  const markerStart = Array.from(text.slice(0, markerIndex)).length;
  const leadingEllipsis = markerStart > 0 ? 1 : 0;
  const budget = Math.max(maximumWindowCharacters - markerLength - leadingEllipsis - 1, 0);
  const lead = Math.min(markerStart, Math.floor(budget / 2));
  const start = markerStart - lead;
  const span = maximumWindowCharacters - (start > 0 ? 1 : 0);
  const end = Math.min(characters.length, start + span - 1);
  const body = characters.slice(start, end).join("");
  return `${start > 0 ? "…" : ""}${body}${end < characters.length ? "…" : ""}`;
};
