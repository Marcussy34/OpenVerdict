"use client"

import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Segmented control: one row of mutually exclusive options. Radix supplies the
 * roving arrow-key focus and the pressed state; the skin is the product's own
 * label language: uppercase Archivo Narrow, sharp corners, one filled segment.
 */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "ov-micro ov-micro-sm inline-flex h-9 items-center justify-center gap-1.5 px-3 whitespace-nowrap text-muted-foreground transition-colors outline-none select-none",
        "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
