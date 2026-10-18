import type { ComponentProps } from 'react';

export type StatusBadgeVariant = 'gray' | 'key' | 'success' | 'error' | 'warning';
export type StatusBadgeSize = 'sm' | 'md';

export type StatusBadgeProps = ComponentProps<'span'> & {
  variant?: StatusBadgeVariant;
  size?: StatusBadgeSize;
};

const variantClasses: Record<StatusBadgeVariant, string> = {
  gray: 'bg-solid-gray-600 text-white',
  key: 'bg-key-900 text-white',
  success: 'bg-success-1 text-white',
  error: 'bg-error-1 text-white',
  warning: 'bg-warning-yellow-2 text-solid-gray-900',
};

const sizeClasses: Record<StatusBadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs rounded-4 font-bold',
  md: 'px-3 py-1 text-sm rounded-6 font-bold',
};

export const StatusBadge = (props: StatusBadgeProps) => {
  const { className, variant = 'gray', size = 'sm', children, ...rest } = props;

  return (
    <span
      className={`inline-flex items-center justify-center tracking-normal whitespace-nowrap ${variantClasses[variant]} ${sizeClasses[size]} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </span>
  );
};
