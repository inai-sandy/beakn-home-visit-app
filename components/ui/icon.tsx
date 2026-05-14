import type { CSSProperties, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

// M3 icon size scale — UI/UX §2.4. Numeric values are the dp/px size the glyph
// renders at; they drive both the font-size utility class and the `opsz`
// variable-font axis so the outline weight stays optically balanced.
export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

type IconProps = HTMLAttributes<HTMLSpanElement> & {
  name: string;
  size?: IconSize;
  fill?: boolean;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
  grade?: -25 | 0 | 200;
};

const SIZE_UTILITY: Record<IconSize, string> = {
  xs: "text-icon-xs",
  sm: "text-icon-sm",
  md: "text-icon-md",
  lg: "text-icon-lg",
  xl: "text-icon-xl",
};

// Material Symbols' `opsz` axis is bounded 20..48; map our scale into it so
// the smallest icons still render with a legal optical size.
const OPSZ: Record<IconSize, number> = {
  xs: 20,
  sm: 20,
  md: 24,
  lg: 40,
  xl: 48,
};

export function Icon({
  name,
  size = "md",
  fill = false,
  weight = 400,
  grade = 0,
  className,
  style,
  ...rest
}: IconProps) {
  const variationStyle: CSSProperties = {
    fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${OPSZ[size]}`,
    ...style,
  };
  // If the caller didn't pass an accessible label, treat the icon as
  // decorative and hide it from assistive tech.
  const isDecorative = !rest["aria-label"] && !rest["aria-labelledby"];
  return (
    <span
      aria-hidden={isDecorative ? true : undefined}
      role={isDecorative ? undefined : "img"}
      className={cn(
        "material-symbols-rounded shrink-0",
        SIZE_UTILITY[size],
        className,
      )}
      style={variationStyle}
      {...rest}
    >
      {name}
    </span>
  );
}
