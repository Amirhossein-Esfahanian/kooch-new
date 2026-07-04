import type { CSSProperties, HTMLAttributes } from "react";

type KoochSvgIconSize = "xs" | "sm" | "md" | "lg" | "xl";

type KoochSvgIconProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  src: string;
  size?: KoochSvgIconSize;
};

const sizeClass: Record<KoochSvgIconSize, string> = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
  xl: "h-8 w-8",
};

export function KoochSvgIcon({
  src,
  size = "sm",
  className = "",
  style,
  ...props
}: KoochSvgIconProps) {
  const maskStyle: CSSProperties = {
    WebkitMask: `url("${src}") center / contain no-repeat`,
    mask: `url("${src}") center / contain no-repeat`,
    ...style,
  };

  return (
    <span
      aria-hidden="true"
      className={[
        "inline-block shrink-0 bg-current",
        sizeClass[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={maskStyle}
      {...props}
    />
  );
}
