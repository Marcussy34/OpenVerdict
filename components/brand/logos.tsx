import { cn } from "@/lib/utils";

/**
 * Third-party brand marks, inlined as SVG so they inherit type colour and need
 * no network fetch. Paths are the official artwork, unmodified:
 *   Sui   — sui.io brand mark, official blue #4DA2FF.
 *   Gonka — gonka.ai/images/logos/gonka.svg (GonkaRouter itself ships only a
 *           wordmark, so the network's mark stands for the router).
 * Both default to `currentColor`; pass `brand` for the official colour.
 */

type MarkProps = {
  className?: string;
  /** Paint the official brand colour instead of the surrounding text colour. */
  brand?: boolean;
  /** Accessible label; omit to render the mark as decoration. */
  title?: string;
};

function markProps({ className, title }: MarkProps) {
  return {
    className: cn("inline-block size-[1em] shrink-0 align-[-0.125em]", className),
    xmlns: "http://www.w3.org/2000/svg",
    ...(title ? { role: "img" as const } : { "aria-hidden": true }),
  };
}

/** The Sui droplet. */
export function SuiMark({ className, brand, title }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" fill={brand ? "#4DA2FF" : "currentColor"} {...markProps({ className, title })}>
      {title && <title>{title}</title>}
      <path d="M17.636 10.009a7.16 7.16 0 0 1 1.565 4.474 7.2 7.2 0 0 1-1.608 4.53l-.087.106-.023-.135a7 7 0 0 0-.07-.349c-.502-2.21-2.142-4.106-4.84-5.642-1.823-1.034-2.866-2.278-3.14-3.693-.177-.915-.046-1.834.209-2.62.254-.787.631-1.446.953-1.843l1.05-1.284a.46.46 0 0 1 .713 0l5.28 6.456zm1.66-1.283L12.26.123a.336.336 0 0 0-.52 0L4.704 8.726l-.023.029a9.33 9.33 0 0 0-2.07 5.872C2.612 19.803 6.816 24 12 24s9.388-4.197 9.388-9.373a9.32 9.32 0 0 0-2.07-5.871zM6.389 9.981l.63-.77.018.142q.023.17.055.34c.408 2.136 1.862 3.917 4.294 5.297 2.114 1.203 3.345 2.586 3.7 4.103a5.3 5.3 0 0 1 .109 1.801l-.004.034-.03.014A7.2 7.2 0 0 1 12 21.67c-3.976 0-7.2-3.218-7.2-7.188 0-1.705.594-3.27 1.587-4.503z" />
    </svg>
  );
}

/** The Gonka mark — the network GonkaRouter routes inference across. */
export function GonkaMark({ className, brand, title }: MarkProps) {
  return (
    <svg viewBox="0 0 44 44" fill={brand ? "#2A2A2A" : "currentColor"} {...markProps({ className, title })}>
      {title && <title>{title}</title>}
      <path d="M22.0779 0.000895182C22.2017 6.07859 22.4682 12.1564 22.8218 18.234C23.2874 26.2385 26.7009 34.2436 29.0827 42.2481C29.1354 42.4251 29.185 42.6029 29.2367 42.7799C26.9701 43.5691 24.5355 44 22 44C19.4649 44 17.0305 43.5698 14.7642 42.7808C14.816 42.6034 14.8663 42.4255 14.9191 42.2481C17.3009 34.2436 20.7144 26.2385 21.18 18.234C21.5336 12.1564 21.7992 6.07859 21.923 0.000895182C21.9487 0.000807303 21.9743 0 22 0C22.026 0 22.0519 0.000805247 22.0779 0.000895182Z" />
      <path d="M20.7262 21.2364C19.4639 28.1647 15.6505 35.0935 12.8718 42.0216C12.0526 41.6475 11.2603 41.2248 10.4987 40.7568C14.3095 34.2502 19.1923 27.7431 20.7262 21.2364Z" />
      <path d="M23.2747 21.2364C24.8085 27.7426 29.6898 34.2498 33.5004 40.7559C32.739 41.2237 31.9472 41.6467 31.1282 42.0208C28.3495 35.093 24.5369 28.1642 23.2747 21.2364Z" />
      <path d="M20.6062 0.0447591C20.5973 6.14511 20.5901 12.2455 20.5641 18.3459C20.5354 25.059 13.5075 31.7743 7.43628 38.4875C2.87637 34.4566 0 28.5647 0 22C0 10.3179 9.10536 0.763813 20.6062 0.0447591Z" />
      <path d="M23.3938 0.0447591C34.8946 0.763813 44 10.3179 44 22C44 28.5649 41.123 34.4565 36.5628 38.4875C30.4919 31.7747 23.4655 25.0585 23.4368 18.3459C23.4108 12.2455 23.4027 6.14511 23.3938 0.0447591Z" />
    </svg>
  );
}
