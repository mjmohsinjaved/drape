'use client';

import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import { AlertCircle } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useIdOr } from '../../lib/use-id';
import { Label } from '../label/Label';

interface FormFieldContextValue {
  controlId: string;
  hintId: string;
  errorId: string;
  hasHint: boolean;
  hasError: boolean;
  required: boolean;
  disabled: boolean;
  registerHint: (present: boolean) => void;
  registerError: (present: boolean) => void;
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

function useFormFieldContext(component: string): FormFieldContextValue {
  const context = React.useContext(FormFieldContext);
  if (!context) {
    throw new Error(`<${component}> must be used inside <FormField>.`);
  }
  return context;
}

/**
 * Read the field's wiring from inside a custom control, when `FormControl` cannot wrap it:
 *
 *   const { controlId, describedBy, invalid } = useFormField();
 */
export function useFormField(): {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
} {
  const context = useFormFieldContext('useFormField');
  return {
    controlId: context.controlId,
    describedBy: describedByFrom(context),
    invalid: context.hasError,
    required: context.required,
    disabled: context.disabled,
  };
}

function describedByFrom(context: FormFieldContextValue): string | undefined {
  const ids = [context.hasHint ? context.hintId : null, context.hasError ? context.errorId : null]
    .filter((id): id is string => id !== null)
    .join(' ');
  return ids.length > 0 ? ids : undefined;
}

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Override the generated control id — for a server-rendered form that already owns one. */
  id?: string;
  /** Marks the control required and renders the required marker on the label. */
  required?: boolean;
  /** Disables the label and control styling. Set `disabled` on the control itself as well. */
  disabled?: boolean;
}

/**
 * The wiring every form control needs and nobody remembers to write by hand: one id shared by
 * the label and the control, `aria-describedby` pointing at the hint and the error, and
 * `aria-invalid` when the error is present.
 *
 *   <FormField required>
 *     <FormLabel>Garment name</FormLabel>
 *     <FormControl><Input placeholder="Anarkali in raw silk" /></FormControl>
 *     <FormHint>Shown to shoppers in the catalog.</FormHint>
 *     <FormError>{errors.name}</FormError>
 *   </FormField>
 *
 * `FormHint` and `FormError` register themselves with the field, so `aria-describedby` lists
 * exactly the descriptions that are actually on screen — never a dangling id.
 */
export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(function FormField(
  { className, id, required = false, disabled = false, children, ...props },
  ref,
) {
  const controlId = useIdOr(id);
  const [hasHint, setHasHint] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);

  const value = React.useMemo<FormFieldContextValue>(
    () => ({
      controlId,
      hintId: `${controlId}-hint`,
      errorId: `${controlId}-error`,
      hasHint,
      hasError,
      required,
      disabled,
      registerHint: setHasHint,
      registerError: setHasError,
    }),
    [controlId, disabled, hasError, hasHint, required],
  );

  return (
    <FormFieldContext.Provider value={value}>
      <div
        ref={ref}
        data-invalid={hasError || undefined}
        data-disabled={disabled || undefined}
        className={cn('flex w-full flex-col gap-1.5', className)}
        {...props}
      >
        {children}
      </div>
    </FormFieldContext.Provider>
  );
});

export type FormLabelProps = Omit<React.ComponentPropsWithoutRef<typeof Label>, 'htmlFor'>;

export const FormLabel = React.forwardRef<HTMLLabelElement, FormLabelProps>(function FormLabel(
  { className, ...props },
  ref,
) {
  const { controlId, required, disabled } = useFormFieldContext('FormLabel');
  return (
    <Label
      ref={ref}
      htmlFor={controlId}
      required={required}
      className={cn(disabled && 'opacity-50', className)}
      {...props}
    />
  );
});

export interface FormControlProps {
  /** Exactly one control element. It receives id, aria-describedby, aria-invalid and aria-required. */
  children: React.ReactNode;
}

/** Applies the field's wiring to whatever control it wraps. */
export function FormControl({ children }: FormControlProps): React.JSX.Element {
  const context = useFormFieldContext('FormControl');
  return (
    <Slot
      id={context.controlId}
      aria-describedby={describedByFrom(context)}
      aria-invalid={context.hasError || undefined}
      aria-required={context.required || undefined}
    >
      {children}
    </Slot>
  );
}

export type FormHintProps = React.HTMLAttributes<HTMLParagraphElement>;

/**
 * The quiet line under a control. Say what the value is for or what shape it must take —
 * "Shown to shoppers in the catalog", not "Enter a name".
 */
export const FormHint = React.forwardRef<HTMLParagraphElement, FormHintProps>(function FormHint(
  { className, children, ...props },
  ref,
) {
  const { hintId, registerHint } = useFormFieldContext('FormHint');
  const present = Boolean(children);

  React.useEffect(() => {
    registerHint(present);
    return () => registerHint(false);
  }, [present, registerHint]);

  if (!present) return null;

  return (
    <p ref={ref} id={hintId} className={cn('text-xs text-ink-muted', className)} {...props}>
      {children}
    </p>
  );
});

export type FormErrorProps = React.HTMLAttributes<HTMLParagraphElement>;

/**
 * The error line. Say what happened and what to do next, in the interface's voice — "Enter a
 * name shoppers will recognise", not "Invalid input" and never "Oops, sorry!" (D-7).
 *
 * Announced politely rather than assertively: a validation message that interrupts mid-typing
 * is a worse experience than one that waits for the pause.
 */
export const FormError = React.forwardRef<HTMLParagraphElement, FormErrorProps>(function FormError(
  { className, children, ...props },
  ref,
) {
  const { errorId, registerError } = useFormFieldContext('FormError');
  const present = Boolean(children);

  React.useEffect(() => {
    registerError(present);
    return () => registerError(false);
  }, [present, registerError]);

  if (!present) return null;

  return (
    <p
      ref={ref}
      id={errorId}
      role="alert"
      aria-live="polite"
      className={cn('flex items-start gap-1.5 text-xs font-medium text-danger', className)}
      {...props}
    >
      <AlertCircle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
});
