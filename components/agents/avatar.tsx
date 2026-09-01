import Image from "next/image";

import { cn } from "@/lib/utils";
import type { JurorFamily } from "@/lib/viz/deliberation-graph";

export const FAMILY_ASSET_COUNT: Record<JurorFamily, number> = {
  deepseek: 3,
  kimi: 2,
  minimax: 2,
  unknown: 0,
};

/**
 * One deterministic variant pick shared by every surface (canvas nodes and
 * inspector alike), so a juror always wears the same face. Key it by the
 * agent's stable identity (agentProfileId) wherever possible.
 */
/**
 * The seven registered jurors wear pinned, distinct faces per family; the
 * hash fallback below covers unknown ids but can collide inside these small
 * art pools (two Kimi faces for two Kimi jurors is a coin flip). Re-pin on
 * the next registry re-registration.
 */
const PINNED_AVATARS: Record<string, number> = {
  // DeepSeek trio
  "0x4ee8af570a34423592e73d14643c9235b477cb1119e9ec6b8785a7dc8c241d94": 1,
  "0x546e1491c2c1fa1e2e857457b74a99ab137ce35d7a0eb4f1e0e29f61727d8cdd": 2,
  "0x5b3a24861fc069cc22687a7cf99adf6d6de0ba2380e39e7806df28f01415da78": 3,
  // MiniMax pair
  "0xf35a7738fdfebd77f0d7698c7aa63678af6f344711be2bd0990370d0e25ccd61": 1,
  "0xcaaab8ea057c54326498260ff00471a26197648c58456782c1c42989d2c003e9": 2,
  // Kimi pair
  "0xb1131089318dce3e1398557ddf86d9e597d7572ed9f0c7b185f1aa42b187230a": 1,
  "0x255a8f65ab223b2d95bdb9a6dc0c31f316661c99a8dc0c48d0f1a0a3ea946be9": 2,
};

export function avatarAssetNumber(
  family: JurorFamily,
  key: string,
): number | undefined {
  const count = FAMILY_ASSET_COUNT[family];
  if (count === 0) return undefined;
  const pinned = PINNED_AVATARS[key];
  if (pinned !== undefined) return ((pinned - 1) % count) + 1;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return (hash % count) + 1;
}

export function JurorAvatar({
  family,
  ordinal,
  avatarKey,
  size = 48,
  className,
}: {
  family: JurorFamily;
  ordinal: number;
  /** Stable identity for the variant pick; falls back to ordinal. */
  avatarKey?: string;
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

  const assetNumber =
    (avatarKey === undefined ? undefined : avatarAssetNumber(family, avatarKey))
    ?? (ordinal % count) + 1;

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
