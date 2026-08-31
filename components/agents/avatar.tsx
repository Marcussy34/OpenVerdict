import Image from "next/image";

import { cn } from "@/lib/utils";
import type { JurorFamily } from "@/lib/viz/deliberation-graph";

export const FAMILY_ASSET_COUNT: Record<JurorFamily, number> = {
  deepseek: 3,
  kimi: 2,
  minimax: 2,
  unknown: 0,
};

export function JurorAvatar({
  family,
  ordinal,
  size = 48,
  className,
}: {
  family: JurorFamily;
  ordinal: number;
  size?: number;
  className?: string;
}) {
  const count = FAMILY_ASSET_COUNT[family];

  if (family === "unknown" || count === 0) {
    return (
      <span
        aria-label={`${family} juror avatar`}
        className={cn(
          "inline-grid shrink-0 place-items-center rounded-full bg-white/10 font-semibold text-white/75",
          className,
        )}
        style={{ width: size, height: size }}
      >
        {family.charAt(0).toUpperCase()}
      </span>
    );
  }

  const assetNumber = (ordinal % count) + 1;

  return (
    <Image
      src={`/media/agents/${family}-${assetNumber}.png`}
      alt={`${family} juror avatar`}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full object-cover", className)}
    />
  );
}
