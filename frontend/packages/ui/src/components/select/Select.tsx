'use client';

import * as React from 'react';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '../../lib/cn';

/**
 * shadcn/Radix Select — **not** React Select. That is the locked decision in §6.3, and it is why
 * the whole product has one popover styling language instead of two.
 */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  size?: 'md' | 'sm' | 'density';
}

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(function SelectTrigger({ className, size = 'md', children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex w-full items-center justify-between gap-2',
        'border border-line-strong bg-surface font-body text-ink',
        'transition-[border-color,box-shadow] duration-fast ease-out',
        'hover:border-ink-subtle',
        'focus-visible:outline-none focus-visible:border-brand focus-visible:shadow-[var(--shadow-focus)]',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-70',
        'aria-[invalid=true]:border-danger',
        'data-[placeholder]:text-ink-subtle',
        '[&>span]:truncate [&>span]:text-start',
        size === 'md' && 'h-11 rounded-md px-3 text-base',
        size === 'sm' && 'h-9 rounded-sm px-2.5 text-sm',
        size === 'density' && 'min-h-control rounded-sm px-2.5 text-density',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        {/* Chevron-down is not a directional icon: down is down in every locale. */}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export type SelectContentProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>;

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn(
          'relative z-50 max-h-96 min-w-32 overflow-hidden rounded-md',
          'border border-line bg-surface-raised text-ink shadow-lg',
          /* No animation plugin: a plain transition on the mounted state. Radix
             unmounts on close, so there is nothing to animate out — and under
             prefers-reduced-motion globals.css clamps this to 1ms anyway (D-11). */
          'origin-[var(--radix-select-content-transform-origin)]',
          'transition-[opacity,scale] duration-fast ease-out',
          'data-[state=closed]:scale-95 data-[state=closed]:opacity-0',
          position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-ink-subtle">
          <ChevronUp aria-hidden="true" className="size-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-ink-subtle">
          <ChevronDown aria-hidden="true" className="size-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export type SelectLabelProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>;

export const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  SelectLabelProps
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn('px-8 py-1.5 text-2xs font-semibold text-ink-subtle uppercase', className)}
      {...props}
    />
  );
});

export type SelectItemProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>;

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  SelectItemProps
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex w-full cursor-pointer items-center rounded-sm py-2 ps-8 pe-2 text-sm outline-none select-none',
        'min-h-9',
        'focus:bg-surface-sunken focus:text-ink',
        'data-[state=checked]:bg-brand-tint data-[state=checked]:text-brand',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

export type SelectSeparatorProps = React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Separator
>;

export const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  SelectSeparatorProps
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />
  );
});
