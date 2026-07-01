import type { CSSProperties } from "react";

const koochIcons = {
  edit: "/svgs/edit.svg",
  capacity: "/svgs/bed-bunk.svg",
  price: "/svgs/tags.svg",
  suspend: "/svgs/ban.svg",
  view: "/svgs/eye.svg",

  notification: "/svgs/bell-l.svg",
  logout: "/svgs/left-from-bracket-l.svg",
  account: "/svgs/user-circle-l.svg",
  menu: "/svgs/sidebar-flip-l.svg",
  close: "/svgs/x-l.svg",
  home: "/svgs/house-l.svg",
  messages: "/svgs/message-l.svg",
  dark: "/svgs/moon-cloud-l.svg",
  light: "/svgs/sun-alt-l.svg",
  search: "/svgs/search-l.svg",
  warning: "/svgs/alert.svg",
  info: "/svgs/info.svg",
  success: "/svgs/success.svg",
  error: "/svgs/error.svg",
} as const;

export type KoochIconName = keyof typeof koochIcons;

export type KoochIconProps = {
  name: KoochIconName;
  className?: string;
  title?: string;
  "aria-label"?: string;
  style?: CSSProperties;
};

export function KoochIcon({
  name,
  className = "",
  title,
  "aria-label": ariaLabel,
  style,
}: KoochIconProps) {
  const iconPath = koochIcons[name];
  const isSvgPath = iconPath?.startsWith("/");

  const baseClass = "inline-block h-6 w-6 shrink-0 bg-current";

  if (!isSvgPath) {
    return (
      <span
        className={[baseClass, className].filter(Boolean).join(" ")}
        style={style}
        title={title}
        aria-hidden={ariaLabel ? undefined : true}
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
      >
        {iconPath}
      </span>
    );
  }

  return (
    <span
      className={[baseClass, className].filter(Boolean).join(" ")}
      style={{
        WebkitMask: `url(${iconPath}) center / contain no-repeat`,
        mask: `url(${iconPath}) center / contain no-repeat`,
        ...style,
      }}
      title={title}
      aria-hidden={ariaLabel ? undefined : true}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
    />
  );
}
