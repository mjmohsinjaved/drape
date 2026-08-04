'use client';

import * as React from 'react';

import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '../../lib/cn';

export interface SliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /**
   * Accessible name for each thumb, in order. A two-thumb price band needs two:
   * `['Lowest price', 'Highest price']`. Without them a screen reader announces "slider, slider".
   */
  thumbLabels?: readonly string[];
  /** Formats the value for `aria-valuetext` — money, sizes, anything a bare number misreports. */
  formatValue?: (value: number) => string;
}

/**
 * Radix takes direction from `<DirectionProvider>`, so in `ur` the track fills from the
 * reading-start side and Left/Right arrows follow the visual, not the logical, order — which is
 * the behaviour users of RTL interfaces expect from a slider.
 */
export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  SliderProps
>(function Slider({ className, thumbLabels, formatValue, ...props }, ref) {
  const values = props.value ?? props.defaultValue ?? [0];

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex w-full touch-none items-center select-none',
        // A 44px tall band around a 4px track, so it can be dragged with a thumb (D-10).
        'h-11',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-surface-sunken">
        <SliderPrimitive.Range className="absolute h-full bg-brand" />
      </SliderPrimitive.Track>
      {values.map((value, index) => (
        <SliderPrimitive.Thumb
          key={index}
          aria-label={thumbLabels?.[index]}
          aria-valuetext={formatValue ? formatValue(value) : undefined}
          className={cn(
            'block size-5 rounded-full border-2 border-brand bg-surface shadow-sm',
            'transition-[box-shadow,scale] duration-fast ease-out',
            'hover:scale-110',
            'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
            'disabled:pointer-events-none',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
});

export interface RangeSliderProps extends Omit<SliderProps, 'value' | 'defaultValue' | 'onValueChange'> {
  /** `[min, max]`. */
  value?: readonly [number, number];
  defaultValue?: readonly [number, number];
  onValueChange?: (value: [number, number]) => void;
  /** Rendered under the track. Give it the formatted band, e.g. "Rs 12,000 – Rs 45,000". */
  caption?: React.ReactNode;
}

/**
 * The price band on the catalog filter. Two thumbs, one range, and a caption that shows the
 * band in the user's own currency formatting rather than making them read the track.
 */
export const RangeSlider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  RangeSliderProps
>(function RangeSlider(
  { value, defaultValue, onValueChange, caption, thumbLabels, className, ...props },
  ref,
) {
  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      <Slider
        ref={ref}
        minStepsBetweenThumbs={1}
        {...(value ? { value: [...value] } : {})}
        {...(defaultValue ? { defaultValue: [...defaultValue] } : {})}
        onValueChange={
          onValueChange
            ? (next) => {
                onValueChange([next[0] ?? 0, next[1] ?? 0]);
              }
            : undefined
        }
        thumbLabels={thumbLabels ?? ['Lowest', 'Highest']}
        {...props}
      />
      {caption ? <p className="text-xs text-ink-muted">{caption}</p> : null}
    </div>
  );
});
