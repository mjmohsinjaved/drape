import type { SVGProps } from 'react';

/**
 * The photo-guidance illustrations — PRD C-13, §10.3.
 *
 * > "Illustrated with **diagrams, not photographs of real people**."
 *
 * So these are drawn: inline SVG line figures, abstract enough that nobody is depicted. That is
 * not only a privacy position — a photograph of a model sets an expectation about who the
 * product is for, and a line drawing does not.
 *
 * They are inline components rather than asset files for three reasons: they inherit
 * `currentColor` so they are correct in Daylight and Lamplight without a second file, they cost
 * no extra request on a 4G first paint, and no raw colour value appears anywhere in them (D-1).
 *
 * Every one is `aria-hidden`: the adjacent heading and body carry the instruction, and a
 * screen-reader user gains nothing from "line drawing of a figure" (D-20).
 */

type DiagramProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'aria-hidden'>;

const FRAME = 'stroke-current opacity-30';
const FIGURE = 'stroke-current';
const ACCENT = 'stroke-current text-brand';

/** The shared abstract figure. Deliberately not a silhouette, and deliberately not gendered. */
function Figure({ className }: { className?: string }) {
  return (
    <g
      className={className}
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={60} cy={34} r={11} />
      <path d="M60 45v8" />
      <path d="M46 53h28l4 46H42z" />
      <path d="M46 55 36 92M74 55l10 37" />
      <path d="M52 99l-2 38M68 99l2 38" />
      <path d="M45 139h11M64 139h11" />
    </g>
  );
}

export function FullBodyDiagram(props: DiagramProps) {
  return (
    <svg viewBox="0 0 120 160" aria-hidden="true" {...props}>
      <rect
        className={FRAME}
        x={8}
        y={8}
        width={104}
        height={144}
        rx={8}
        fill="none"
        strokeWidth={2}
      />
      <Figure className={FIGURE} />
      {/* The headroom and the floor gap — the two things people get wrong. */}
      <path
        className={ACCENT}
        d="M20 20h80M20 148h80"
        fill="none"
        strokeWidth={2}
        strokeDasharray="4 5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FrontFacingDiagram(props: DiagramProps) {
  return (
    <svg viewBox="0 0 120 160" aria-hidden="true" {...props}>
      <rect
        className={FRAME}
        x={8}
        y={8}
        width={104}
        height={144}
        rx={8}
        fill="none"
        strokeWidth={2}
      />
      <Figure className={FIGURE} />
      {/* A centre axis and two level shoulder markers: square to the camera. */}
      <path
        className={ACCENT}
        d="M60 16v128"
        fill="none"
        strokeWidth={2}
        strokeDasharray="4 5"
        strokeLinecap="round"
      />
      <circle className={ACCENT} cx={46} cy={54} r={3.5} fill="none" strokeWidth={2} />
      <circle className={ACCENT} cx={74} cy={54} r={3.5} fill="none" strokeWidth={2} />
    </svg>
  );
}

export function PlainBackgroundDiagram(props: DiagramProps) {
  return (
    <svg viewBox="0 0 120 160" aria-hidden="true" {...props}>
      <rect
        className={FRAME}
        x={8}
        y={8}
        width={104}
        height={144}
        rx={8}
        fill="none"
        strokeWidth={2}
      />
      {/* An empty wall plane behind her — one horizon line and nothing else on it. */}
      <path
        className={ACCENT}
        d="M14 118h92"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Figure className={FIGURE} />
    </svg>
  );
}

export function FittedClothingDiagram(props: DiagramProps) {
  return (
    <svg viewBox="0 0 120 160" aria-hidden="true" {...props}>
      <rect
        className={FRAME}
        x={8}
        y={8}
        width={104}
        height={144}
        rx={8}
        fill="none"
        strokeWidth={2}
      />
      {/* The dashed outline is the loose layer to leave off; the solid figure is what to wear. */}
      <path
        className={`${FRAME} opacity-40`}
        d="M38 52h44l8 54H30z"
        fill="none"
        strokeWidth={2}
        strokeDasharray="5 5"
        strokeLinejoin="round"
      />
      <Figure className={FIGURE} />
    </svg>
  );
}

export function GoodLightDiagram(props: DiagramProps) {
  return (
    <svg viewBox="0 0 120 160" aria-hidden="true" {...props}>
      <rect
        className={FRAME}
        x={8}
        y={8}
        width={104}
        height={144}
        rx={8}
        fill="none"
        strokeWidth={2}
      />
      <Figure className={FIGURE} />
      {/* A window in front of her, throwing light onto the figure rather than behind it. */}
      <g
        className={ACCENT}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x={16} y={30} width={18} height={26} rx={2} />
        <path d="M25 30v26M16 43h18" />
        <path d="M38 40h10M38 52h8M38 64h10" />
      </g>
    </svg>
  );
}

export function ChestHeightDiagram(props: DiagramProps) {
  return (
    <svg viewBox="0 0 120 160" aria-hidden="true" {...props}>
      <Figure className={FIGURE} />
      {/* The phone, level, at the height of the chest. */}
      <g
        className={ACCENT}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x={92} y={58} width={18} height={30} rx={3} />
        <path d="M98 63h6" />
        <path d="M12 73h78" strokeDasharray="4 5" />
      </g>
    </svg>
  );
}

/** Keyed by the message key each diagram belongs to, so the list below stays declarative. */
export const PHOTO_GUIDANCE_DIAGRAMS = {
  fullBody: FullBodyDiagram,
  frontFacing: FrontFacingDiagram,
  plainBackground: PlainBackgroundDiagram,
  fittedClothing: FittedClothingDiagram,
  goodLight: GoodLightDiagram,
  chestHeight: ChestHeightDiagram,
} as const;

export type PhotoGuidanceKey = keyof typeof PHOTO_GUIDANCE_DIAGRAMS;

export const PHOTO_GUIDANCE_ORDER: readonly PhotoGuidanceKey[] = [
  'fullBody',
  'frontFacing',
  'plainBackground',
  'fittedClothing',
  'goodLight',
  'chestHeight',
];
