'use client';

import * as React from 'react';

import { Check, ChevronDown, Search } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Popover, PopoverAnchor, PopoverContent } from '../popover/Popover';
import { Spinner } from '../spinner/Spinner';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary line, e.g. a SKU or a category path. */
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  value?: string | null;
  onValueChange: (value: string | null) => void;
  /** Controlled query, for server-side search. Leave unset to filter locally. */
  query?: string;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  /** Shown when the query matches nothing. Say what to try next, not "No results" (D-6, D-7). */
  emptyMessage?: React.ReactNode;
  disabled?: boolean;
  /** Spinner in the field while a server-side search is in flight. */
  loading?: boolean;
  /** Allow clearing back to no selection. */
  clearable?: boolean;
  clearLabel?: string;
  id?: string;
  name?: string;
  className?: string;
  size?: 'md' | 'sm';
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/**
 * A text field that filters a list — the admin's category picker, garment search, consumer
 * lookup.
 *
 * Built on the WAI-ARIA combobox pattern with `aria-activedescendant`: focus stays in the input
 * while the arrow keys move the visual highlight, which is what lets a user keep typing to
 * narrow the list. Enter picks, Escape closes without changing the value, Home/End jump.
 *
 * Use `Select` when the list is short and fixed; a combobox is for lists too long to scan.
 */
export function Combobox({
  options,
  value = null,
  onValueChange,
  query,
  onQueryChange,
  placeholder = 'Search',
  emptyMessage = 'Nothing matches that. Try a shorter search.',
  disabled = false,
  loading = false,
  clearable = false,
  clearLabel = 'Clear selection',
  id,
  name,
  className,
  size = 'md',
  ...aria
}: ComboboxProps): React.JSX.Element {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const listboxId = `${controlId}-listbox`;

  const [open, setOpen] = React.useState(false);
  const [innerQuery, setInnerQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const serverFiltered = query !== undefined;
  const currentQuery = serverFiltered ? query : innerQuery;

  const selected = options.find((option) => option.value === value) ?? null;

  const visible = React.useMemo(() => {
    if (serverFiltered || currentQuery.trim() === '') return options;
    const needle = currentQuery.trim().toLocaleLowerCase();
    return options.filter(
      (option) =>
        option.label.toLocaleLowerCase().includes(needle) ||
        (option.description?.toLocaleLowerCase().includes(needle) ?? false),
    );
  }, [options, currentQuery, serverFiltered]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [currentQuery, open]);

  const setQuery = (next: string): void => {
    if (serverFiltered) onQueryChange?.(next);
    else setInnerQuery(next);
  };

  const commit = (option: ComboboxOption): void => {
    if (option.disabled) return;
    onValueChange(option.value);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const move = (delta: number): void => {
    if (visible.length === 0) return;
    setActiveIndex((current) => {
      const next = (current + delta + visible.length) % visible.length;
      listRef.current
        ?.querySelector(`[data-index="${String(next)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
      return next;
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(Math.max(visible.length - 1, 0));
    } else if (event.key === 'Enter' && open) {
      const option = visible[activeIndex];
      if (option) {
        event.preventDefault();
        commit(option);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            'relative flex w-full items-center gap-2 border border-line-strong bg-surface',
            'transition-[border-color,box-shadow] duration-fast ease-out',
            'focus-within:border-brand focus-within:shadow-[var(--shadow-focus)]',
            size === 'md' && 'h-11 rounded-md px-3',
            size === 'sm' && 'h-9 rounded-sm px-2.5',
            disabled && 'cursor-not-allowed bg-surface-sunken opacity-70',
            className,
          )}
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
          <input
            ref={inputRef}
            id={controlId}
            name={name}
            role="combobox"
            type="text"
            autoComplete="off"
            disabled={disabled}
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              open && visible[activeIndex] ? `${listboxId}-${String(activeIndex)}` : undefined
            }
            aria-describedby={aria['aria-describedby']}
            aria-invalid={aria['aria-invalid']}
            value={open ? currentQuery : (selected?.label ?? '')}
            placeholder={selected ? selected.label : placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            className={cn(
              'min-w-0 flex-1 bg-transparent font-body text-ink outline-none',
              'placeholder:text-ink-subtle',
              size === 'md' ? 'text-base' : 'text-sm',
            )}
          />
          {loading ? <Spinner size="xs" label={null} /> : null}
          {clearable && selected && !disabled ? (
            <button
              type="button"
              onClick={() => {
                onValueChange(null);
                setQuery('');
                inputRef.current?.focus();
              }}
              className="rounded-xs text-ink-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            >
              <span aria-hidden="true">&#215;</span>
              <VisuallyHidden>{clearLabel}</VisuallyHidden>
            </button>
          ) : null}
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-1"
        // Focus must stay in the input for aria-activedescendant to mean anything.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">{emptyMessage}</p>
        ) : (
          <ul ref={listRef} id={listboxId} role="listbox" className="max-h-64 overflow-y-auto">
            {visible.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-${String(index)}`}
                role="option"
                data-index={index}
                aria-selected={option.value === value}
                aria-disabled={option.disabled}
                onPointerDown={(event) => {
                  event.preventDefault();
                  commit(option);
                }}
                onPointerMove={() => setActiveIndex(index)}
                className={cn(
                  'flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm',
                  index === activeIndex && 'bg-surface-sunken',
                  option.value === value && 'text-brand',
                  option.disabled && 'pointer-events-none opacity-50',
                )}
              >
                <Check
                  aria-hidden="true"
                  className={cn('size-4 shrink-0', option.value === value ? '' : 'invisible')}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{option.label}</span>
                  {option.description ? (
                    <span className="truncate text-xs text-ink-subtle">{option.description}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
