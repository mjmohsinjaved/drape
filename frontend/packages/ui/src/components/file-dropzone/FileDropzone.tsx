'use client';

import * as React from 'react';

import { Check, RotateCw, Upload, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { IconButton } from '../icon-button/IconButton';
import { ProgressBar } from '../progress/ProgressBar';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

export interface UploadFile {
  id: string;
  name: string;
  size?: number;
  progress?: number;
  status: UploadStatus;
  error?: string;
  previewUrl?: string;
  meta?: React.ReactNode;
}

export interface FileDropzoneProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'onDrop'> {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  files?: readonly UploadFile[];
  onRemoveFile?: (id: string) => void;
  onRetryFile?: (id: string) => void;
  label: string;
  hint?: React.ReactNode;
  browseLabel?: string;
  removeLabel?: string;
  retryLabel?: string;
  doneLabel?: string;
  filesLabel?: string;
  formatSize?: (bytes: number) => string;
}

export const FileDropzone = React.forwardRef<HTMLDivElement, FileDropzoneProps>(
  function FileDropzone(
    {
      className,
      accept,
      multiple = true,
      disabled = false,
      onFilesSelected,
      files = [],
      onRemoveFile,
      onRetryFile,
      label,
      hint,
      browseLabel = 'Choose files',
      removeLabel = 'Remove',
      retryLabel = 'Try this upload again',
      doneLabel = 'Uploaded',
      filesLabel = 'Selected files',
      formatSize,
      ...props
    },
    ref,
  ) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = React.useState(false);

    const emit = (list: FileList | null): void => {
      if (!list || list.length === 0) return;
      onFilesSelected([...list]);
    };

    return (
      <div ref={ref} className={cn('flex w-full flex-col gap-3', className)} {...props}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled) emit(event.dataTransfer.files);
          }}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed',
            'px-6 py-10 text-center transition-colors duration-fast ease-out',
            'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
            dragging ? 'border-brand bg-brand-tint' : 'border-line-strong bg-surface-sunken',
            !disabled && 'hover:border-brand hover:bg-brand-tint',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <Upload aria-hidden="true" className="size-6 text-ink-subtle" />
          <span className="text-sm font-medium text-ink">{label}</span>
          <span className="text-xs text-ink-muted">{browseLabel}</span>
          {hint ? <span className="text-xs text-ink-subtle">{hint}</span> : null}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="hidden"
          onChange={(event) => {
            emit(event.target.files);
            event.target.value = '';
          }}
        />

        {files.length > 0 ? (
          <ul aria-label={filesLabel} className="flex flex-col gap-2">
            {files.map((file) => (
              <li
                key={file.id}
                className={cn(
                  'flex items-center gap-3 rounded-md border border-line bg-surface p-3',
                  file.status === 'error' && 'border-danger/40 bg-danger-tint',
                )}
              >
                {file.previewUrl ? (
                  <img
                    src={file.previewUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-sm object-cover"
                  />
                ) : null}

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-ink">{file.name}</span>
                    {file.size !== undefined && formatSize ? (
                      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">
                        {formatSize(file.size)}
                      </span>
                    ) : null}
                  </div>

                  {file.status === 'done' ? (
                    <div className="flex items-center gap-1.5">
                      <ProgressBar size="sm" tone="success" value={100} label={`${file.name}: ${doneLabel}`} />
                      <Check aria-hidden="true" className="size-3.5 shrink-0 text-success" />
                    </div>
                  ) : file.status === 'uploading' || file.status === 'queued' ? (
                    <ProgressBar
                      size="sm"
                      value={file.status === 'queued' ? null : (file.progress ?? 0)}
                      label={`Uploading ${file.name}`}
                    />
                  ) : null}

                  {file.status === 'error' && file.error ? (
                    <p className="text-xs font-medium text-danger">{file.error}</p>
                  ) : null}

                  {file.meta}
                </div>

                {file.status === 'error' && onRetryFile ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`${retryLabel}: ${file.name}`}
                    icon={<RotateCw />}
                    onClick={() => onRetryFile(file.id)}
                  />
                ) : null}

                {onRemoveFile ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`${removeLabel}: ${file.name}`}
                    icon={<X />}
                    onClick={() => onRemoveFile(file.id)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <VisuallyHidden aria-live="polite">
          {files.filter((file) => file.status === 'done').length > 0
            ? `${String(files.filter((file) => file.status === 'done').length)} of ${String(files.length)} uploaded`
            : ''}
        </VisuallyHidden>
      </div>
    );
  },
);
