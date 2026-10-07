import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative w-full rounded-lg border p-4 text-sm", {
  variants: {
    variant: {
      default: "bg-background text-foreground",
      destructive: "border-destructive/50 text-destructive",
      success: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
    },
  },
  defaultVariants: { variant: "default" },
});

const Alert = ({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) => (
  <div role={variant === "destructive" ? "alert" : "status"} className={cn(alertVariants({ variant }), className)} {...props} />
);

export { Alert };
