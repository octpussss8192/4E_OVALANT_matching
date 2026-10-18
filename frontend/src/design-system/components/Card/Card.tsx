import type { ComponentProps } from 'react';

export type CardProps = ComponentProps<'div'> & {
  variant?: 'default' | 'key' | 'gray';
};

export const Card = (props: CardProps) => {
  const { className, variant = 'default', children, ...rest } = props;

  let variantStyle = 'bg-white border-solid-gray-300 text-solid-gray-900';
  if (variant === 'key') {
    variantStyle = 'bg-white border-key-900 text-solid-gray-900';
  } else if (variant === 'gray') {
    variantStyle = 'bg-solid-gray-50 border-solid-gray-300 text-solid-gray-900';
  }

  return (
    <div
      className={`rounded-8 border p-5 bg-white ${variantStyle} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>
  );
};
