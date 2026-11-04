// Browser-free layout checks used by the test/dev runtime audit. The client
// supplies measured boxes; this module only compares rectangles.

export interface AuditRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LayoutAuditElement {
  id: string;
  group: string;
  rect: AuditRect;
  interactive: boolean;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

export type LayoutIssueKind =
  | "outside"
  | "overlap"
  | "clipped"
  | "small-target";

export interface LayoutIssue {
  kind: LayoutIssueKind;
  id: string;
  other?: string;
  detail: string;
}

const EDGE_TOLERANCE_PX = 1;

function overlaps(a: AuditRect, b: AuditRect): boolean {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 1 && height > 1;
}

/** Check one frame of measured UI boxes against the current viewport. */
export function auditLayout(
  elements: readonly LayoutAuditElement[],
  viewport: { width: number; height: number },
  minTargetPx: number,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const visible = elements.filter(
    (element) =>
      element.rect.right > element.rect.left &&
      element.rect.bottom > element.rect.top,
  );

  for (const element of visible) {
    const { rect } = element;
    if (
      rect.left < -EDGE_TOLERANCE_PX ||
      rect.top < -EDGE_TOLERANCE_PX ||
      rect.right > viewport.width + EDGE_TOLERANCE_PX ||
      rect.bottom > viewport.height + EDGE_TOLERANCE_PX
    ) {
      issues.push({
        kind: "outside",
        id: element.id,
        detail: `${Math.round(rect.left)},${Math.round(rect.top)} to ${Math.round(rect.right)},${Math.round(rect.bottom)} in ${viewport.width}x${viewport.height}`,
      });
    }

    if (
      element.scrollWidth > element.clientWidth + EDGE_TOLERANCE_PX ||
      element.scrollHeight > element.clientHeight + EDGE_TOLERANCE_PX
    ) {
      issues.push({
        kind: "clipped",
        id: element.id,
        detail: `${element.scrollWidth}x${element.scrollHeight} content in ${element.clientWidth}x${element.clientHeight}`,
      });
    }

    if (
      element.interactive &&
      (rect.right - rect.left < minTargetPx ||
        rect.bottom - rect.top < minTargetPx)
    ) {
      issues.push({
        kind: "small-target",
        id: element.id,
        detail: `${Math.round(rect.right - rect.left)}x${Math.round(rect.bottom - rect.top)}`,
      });
    }
  }

  for (let first = 0; first < visible.length; first += 1) {
    const a = visible[first]!;
    for (let second = first + 1; second < visible.length; second += 1) {
      const b = visible[second]!;
      if (a.group !== b.group) continue;
      if (!overlaps(a.rect, b.rect)) continue;
      issues.push({
        kind: "overlap",
        id: a.id,
        other: b.id,
        detail: "boxes intersect",
      });
    }
  }

  return issues;
}

export function layoutIssueSummary(issues: readonly LayoutIssue[]): string {
  if (issues.length === 0) return "Layout audit: clean";
  const kinds = new Set(issues.map((issue) => issue.kind));
  return `Layout audit: ${issues.length} issue${issues.length === 1 ? "" : "s"} (${[...kinds].join(", ")})`;
}
