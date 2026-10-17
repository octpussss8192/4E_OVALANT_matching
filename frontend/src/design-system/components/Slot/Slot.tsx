import { Children, cloneElement, type HTMLAttributes, isValidElement, type ReactNode } from 'react';

type SlotProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
};

export const Slot = (props: SlotProps) => {
  const { children, ...rest } = props;

  if (isValidElement(children)) {
    const childProps: any = children.props || {};
    return cloneElement(children as any, {
      ...rest,
      ...childProps,
      className: `${rest.className ?? ''} ${childProps.className ?? ''}`,
    });
  }

  if (Children.count(children) > 1) {
    Children.only(null);
  }

  return null;
};
