"use client";

import * as Iconsax from "iconsax-react";
import type { Icon, IconProps } from "iconsax-react";

/**
 * The app's single icon surface.
 *
 * iconsax-react ships its `color` / `size` defaults through the legacy React
 * `defaultProps` API. React 19 removed `defaultProps` for function components,
 * so every icon rendered with `fill`/`stroke` undefined — the SVG root sets
 * `fill="none"`, which the paths then inherit, and the entire icon set drew
 * nothing at all. Re-applying `color="currentColor"` here restores inheritance
 * from the surrounding Tailwind text colour.
 *
 * Import icons from `@/components/icons`, never from `iconsax-react` directly.
 */
function icon(Base: Icon, name: string): Icon {
  const Wrapped = (props: IconProps) => (
    <Base color="currentColor" size="16" aria-hidden {...props} />
  );
  Wrapped.displayName = `Icon(${name})`;
  return Wrapped;
}

/** Every icon the app uses, wrapped once. Keep alphabetical. */
export const Activity = icon(Iconsax.Activity, "Activity");
export const Add = icon(Iconsax.Add, "Add");
export const ArrowDown2 = icon(Iconsax.ArrowDown2, "ArrowDown2");
export const ArrowLeft2 = icon(Iconsax.ArrowLeft2, "ArrowLeft2");
export const ArrowRight = icon(Iconsax.ArrowRight, "ArrowRight");
export const ArrowRight2 = icon(Iconsax.ArrowRight2, "ArrowRight2");
export const Award = icon(Iconsax.Award, "Award");
export const Book1 = icon(Iconsax.Book1, "Book1");
export const Box = icon(Iconsax.Box, "Box");
export const Chart = icon(Iconsax.Chart, "Chart");
export const Clock = icon(Iconsax.Clock, "Clock");
export const CloseCircle = icon(Iconsax.CloseCircle, "CloseCircle");
export const Code1 = icon(Iconsax.Code1, "Code1");
export const Copy = icon(Iconsax.Copy, "Copy");
export const CopySuccess = icon(Iconsax.CopySuccess, "CopySuccess");
export const Cpu = icon(Iconsax.Cpu, "Cpu");
export const Data = icon(Iconsax.Data, "Data");
export const DocumentCode = icon(Iconsax.DocumentCode, "DocumentCode");
export const DocumentDownload = icon(Iconsax.DocumentDownload, "DocumentDownload");
export const DocumentText = icon(Iconsax.DocumentText, "DocumentText");
export const Element3 = icon(Iconsax.Element3, "Element3");
export const ExportSquare = icon(Iconsax.ExportSquare, "ExportSquare");
export const Eye = icon(Iconsax.Eye, "Eye");
export const Filter = icon(Iconsax.Filter, "Filter");
export const Flash = icon(Iconsax.Flash, "Flash");
export const Global = icon(Iconsax.Global, "Global");
export const Hierarchy = icon(Iconsax.Hierarchy, "Hierarchy");
export const InfoCircle = icon(Iconsax.InfoCircle, "InfoCircle");
export const Judge = icon(Iconsax.Judge, "Judge");
export const KeySquare = icon(Iconsax.KeySquare, "KeySquare");
export const Link21 = icon(Iconsax.Link21, "Link21");
export const Lock = icon(Iconsax.Lock, "Lock");
export const LogoutCurve = icon(Iconsax.LogoutCurve, "LogoutCurve");
export const MoneyRecive = icon(Iconsax.MoneyRecive, "MoneyRecive");
export const People = icon(Iconsax.People, "People");
export const Profile2User = icon(Iconsax.Profile2User, "Profile2User");
export const Radar = icon(Iconsax.Radar, "Radar");
export const Refresh = icon(Iconsax.Refresh, "Refresh");
export const SearchNormal1 = icon(Iconsax.SearchNormal1, "SearchNormal1");
export const SecuritySafe = icon(Iconsax.SecuritySafe, "SecuritySafe");
export const Send2 = icon(Iconsax.Send2, "Send2");
export const ShieldCross = icon(Iconsax.ShieldCross, "ShieldCross");
export const ShieldSearch = icon(Iconsax.ShieldSearch, "ShieldSearch");
export const ShieldTick = icon(Iconsax.ShieldTick, "ShieldTick");
export const Timer1 = icon(Iconsax.Timer1, "Timer1");
export const TickCircle = icon(Iconsax.TickCircle, "TickCircle");
export const Trash = icon(Iconsax.Trash, "Trash");
export const Unlock = icon(Iconsax.Unlock, "Unlock");
export const Wallet = icon(Iconsax.Wallet, "Wallet");
export const Warning2 = icon(Iconsax.Warning2, "Warning2");

/** Prop shape of every wrapped icon — use for `icon={Foo}` component props. */
export type IconComponent = Icon;

export type { Icon, IconProps };
