'use client';

import * as React from 'react';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';

const avatarVariants = cva(
  'relative inline-flex shrink-0 overflow-hidden rounded-full bg-surface-sunken select-none',
  {
    variants: {
      size: {
        xs: 'size-6 text-2xs',
        sm: 'size-8 text-xs',
        md: 'size-10 text-sm',
        lg: 'size-14 text-base',
        xl: 'size-20 text-xl',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface AvatarProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {}

export const Avatar = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(function Avatar({ className, size, ...props }, ref) {
  return (
    <AvatarPrimitive.Root ref={ref} className={cn(avatarVariants({ size }), className)} {...props} />
  );
});

export interface AvatarImageProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> {
  /** Required. A person's name, not "avatar" (D-20). */
  alt: string;
}

export const AvatarImage = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Image>,
  AvatarImageProps
>(function AvatarImage({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Image
      ref={ref}
      className={cn('size-full object-cover', className)}
      {...props}
    />
  );
});

export type AvatarFallbackProps = React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>;

/**
 * Shown while the image loads and if it fails. Give it initials, not an icon of a person —
 * initials survive a 24px thumbnail in an admin table.
 */
export const AvatarFallback = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Fallback>,
  AvatarFallbackProps
>(function AvatarFallback({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        'flex size-full items-center justify-center bg-brand-tint font-body font-semibold text-brand uppercase',
        className,
      )}
      {...props}
    />
  );
});

/** First letters of the first and last word. Latin-safe, and a no-op for scripts without case. */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`;
}
