import type { ComponentProps } from 'react';

export type CardProps = ComponentProps<'div'> & {
  variant?: 'default' | 'success' | 'warning' | 'error';
};

export const Card = (props: CardProps) => {
  const { className, variant = 'default', children, ...rest } = props;

  let variantStyle = 'bg-white border-solid-gray-300';
  if (variant === 'success') {
    variantStyle = 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500';
  } else if (variant === 'warning') {
    variantStyle = 'bg-amber-50 border-amber-400';
  } else if (variant === 'error') {
    variantStyle = 'bg-red-50 border-red-400';
  }

  return (
    <div
      className={`rounded-12 border p-5 shadow-sm transition-all duration-200 ${variantStyle} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>
  );
};
