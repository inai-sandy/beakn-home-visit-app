"use client"

import * as React from "react"
import * as AccordionPrimitive from "@radix-ui/react-accordion"

import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

// =============================================================================
// HVA-169: shadcn Accordion primitive (slim, radix-backed)
// =============================================================================
//
// Used by app/(exec)/dashboard for the Pending / Postponed / Completed
// task sections. Matches the visual idiom of the rest of components/ui/
// (radix subimport, data-slot attrs, cn for class merge, Material Symbols
// icon as the chevron).
// =============================================================================

const Accordion = AccordionPrimitive.Root

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b last:border-b-0", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "flex flex-1 items-center justify-between gap-3 py-3 text-left text-sm font-medium transition-all",
          "hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm",
          "[&[data-state=open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
        <Icon
          name="expand_more"
          size="sm"
          className="shrink-0 text-muted-foreground transition-transform duration-200"
          aria-hidden
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className={cn(
        "overflow-hidden text-sm",
        "data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
      )}
      {...props}
    >
      <div className={cn("pb-3 pt-1", className)}>{children}</div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
