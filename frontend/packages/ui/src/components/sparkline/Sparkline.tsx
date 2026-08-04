import * as React from 'react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface SparklineProps extends Omit<React.SVGProps<SVGSVGElement>, 'values'> {
  /** The series, oldest first. Fewer than two points renders a flat rule. */
  values: readonly number[];
  /**
   * Text alternative. A chart with no alternative is invisible to a screen reader — say the
   * shape and the endpoints: "Try-ons per day, rising from 4 to 21 over 14 days" (D-20).
   */
  label: string;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
  /** Fill the area under the line. */
  area?: boolean;
  width?: number;
  height?: number;
}

const toneStroke: Record<NonNullable<SparklineProps['tone']>, string> = {
  brand: 'stroke-brand',
  success: 'stroke-success',
  warning: 'stroke-warning',
  danger: 'stroke-danger',
  info: 'stroke-info',
  muted: 'stroke-ink-subtle',
};

const toneFill: Record<NonNullable<SparklineProps['tone']>, string> = {
  brand: 'fill-brand',
  success: 'fill-success',
  warning: 'fill-warning',
  danger: 'fill-danger',
  info: 'fill-info',
  muted: 'fill-ink-subtle',
};

/**
 * A trend line for the admin analytics tiles. Pure SVG — no charting dependency for a shape that
 * is twelve points wide.
 *
 * The drawing runs left-to-right in both locales: a time series reads chronologically, and
 * mirroring it would say the trend ran the other way.
 */
export const Sparkline = React.forwardRef<SVGSVGElement, SparklineProps>(function Sparkline(
  { className, values, label, tone = 'brand', area = false, width = 120, height = 32, ...props },
  ref,
) {
  const points = React.useMemo(() => {
    if (values.length === 0) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = values.length > 1 ? width / (values.length - 1) : 0;

    return values
      .map((value, index) => {
        const x = index * step;
        const y = height - ((value - min) / span) * height;
        return `${String(Number(x.toFixed(2)))},${String(Number(y.toFixed(2)))}`;
      })
      .join(' ');
  }, [values, width, height]);

  return (
    <span className={cn('inline-flex items-center', className)}>
      <svg
        ref={ref}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        preserveAspectRatio="none"
        className="h-8 w-full overflow-visible"
        aria-hidden="true"
        {...props}
      >
        {area && points ? (
          <polygon
            points={`0,${String(height)} ${points} ${String(width)},${String(height)}`}
            className={cn(toneFill[tone], 'opacity-10')}
          />
        ) : null}
        <polyline
          points={points}
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className={toneStroke[tone]}
        />
      </svg>
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
});
