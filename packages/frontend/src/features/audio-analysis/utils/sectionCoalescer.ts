/**
 * sectionCoalescer — merges adjacent song sections of the same type so the
 * section display does not flicker between many tiny same-typed segments.
 */

export interface DisplaySection {
  type: string;
  start: number;
  end: number;
  energy: number;
}

/** Merge consecutive sections that share the same `type`. */
export function coalesceSections(
  sections: Array<{ type: string; start: number; end: number; energy: number }>,
): DisplaySection[] {
  const out: DisplaySection[] = [];
  for (const section of sections) {
    const last = out[out.length - 1];
    if (last && last.type === section.type && last.end === section.start) {
      last.end = section.end;
      last.energy = Math.max(last.energy, section.energy);
    } else {
      out.push({ ...section });
    }
  }
  return out;
}
