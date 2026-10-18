import type { ReactNode } from 'react';
import { NotificationBannerIcon } from './parts/Icon';
import { bannerStyleClasses, bannerTypeClasses } from './styles';
import type {
  NotificationBannerHeadingLevel,
  NotificationBannerStyle,
  NotificationBannerType,
} from './types';

type Props = {
  className?: string;
  children: ReactNode;
  bannerStyle: NotificationBannerStyle;
  type: NotificationBannerType;
  title: string;
  headingLevel?: NotificationBannerHeadingLevel;
};

export const NotificationBanner = (props: Props) => {
  const { className, children, bannerStyle, type, title, headingLevel } = props;
  const Tag = headingLevel ?? 'div';

  return (
    <div
      className={`
        border-current p-4 rounded-12 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 bg-white
        ${bannerStyleClasses}
        ${bannerTypeClasses}
        ${className ?? ''}
      `}
      data-type={type}
      data-style={bannerStyle}
    >
      <Tag className="flex items-center gap-2.5 shrink-0">
        <NotificationBannerIcon
          className="size-6 shrink-0 desktop:size-7"
          type={type}
        />
        <span className="font-bold text-base desktop:text-lg text-solid-gray-900 whitespace-nowrap">
          {title}
        </span>
      </Tag>
      {children && (
        <div className="text-sm desktop:text-base text-solid-gray-800 flex-1 min-w-0">
          {children}
        </div>
      )}
    </div>
  );
};
