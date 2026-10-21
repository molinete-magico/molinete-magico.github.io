function parseIntegerAttribute(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^[+-]?\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function orderedListStart(startAttribute: string | null): number {
  return parseIntegerAttribute(startAttribute) ?? 1;
}

export function orderedListItemNumber(valueAttribute: string | null, nextNumber: number): number {
  return parseIntegerAttribute(valueAttribute) ?? nextNumber;
}
