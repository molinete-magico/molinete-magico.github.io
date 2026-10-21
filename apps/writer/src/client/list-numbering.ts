export function orderedListStart(startAttribute: string | null): number {
  if (startAttribute === null) return 1;
  const parsed = Number.parseInt(startAttribute, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

export function orderedListItemNumber(valueAttribute: string | null, nextNumber: number): number {
  if (valueAttribute === null) return nextNumber;
  const parsed = Number.parseInt(valueAttribute, 10);
  return Number.isFinite(parsed) ? parsed : nextNumber;
}
