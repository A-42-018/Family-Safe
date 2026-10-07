import * as React from "react";
import { cn } from "@/lib/utils";

const Card = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />
);
const CardHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
);
// Defaults to h1 (auth pages use the card title as the page title); shell pages pass as="h2" under <PageHeader>.
const CardTitle = ({ className, as: Tag = "h1", ...props }: React.ComponentProps<"h1"> & { as?: "h1" | "h2" | "h3" }) => (
  <Tag className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
);
const CardDescription = ({ className, ...props }: React.ComponentProps<"p">) => (
  <p className={cn("text-sm text-muted-foreground", className)} {...props} />
);
const CardContent = ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("p-6 pt-0", className)} {...props} />;
const CardFooter = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={cn("flex items-center p-6 pt-0", className)} {...props} />
);

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
