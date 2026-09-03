import { StrictMode, forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown, X } from "lucide-react";
import { cn } from "./utils";
import "./styles.css";

const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50", {
  variants: { variant: { default: "bg-primary text-primary-foreground hover:bg-primary/90", outline: "border border-border bg-background hover:bg-primary/5", ghost: "hover:bg-primary/5", destructive: "text-red-600 hover:bg-red-50" }, size: { default: "h-9 px-4 py-2", icon: "h-9 w-9" } },
  defaultVariants: { variant: "default", size: "default" },
});
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input className={cn("flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1", className)} ref={ref} {...props} />
));
const badgeVariants = cva("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold", { variants: { variant: { default: "border-transparent bg-primary text-primary-foreground", secondary: "border-transparent bg-primary/10 text-primary" } }, defaultVariants: { variant: "default" } });
function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) { return <div className={cn(badgeVariants({ variant }), className)} {...props} />; }

function App() {
  return (
    <div className="flex gap-3 p-4">
      <DialogPrimitive.Root>
        <DialogPrimitive.Trigger asChild><Button data-testid="S-1.btn">Открыть</Button></DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <DialogPrimitive.Content data-testid="M-1" className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
            <DialogPrimitive.Title className="text-lg font-semibold">Заголовок</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm">Описание</DialogPrimitive.Description>
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70"><X className="h-4 w-4" /></DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <Input data-testid="S-1.input" />
      <SelectPrimitive.Root defaultValue="a">
        <SelectPrimitive.Trigger className="flex h-9 items-center justify-between rounded-md border border-border px-3 text-sm"><SelectPrimitive.Value /><SelectPrimitive.Icon asChild><ChevronDown className="h-4 w-4 opacity-50" /></SelectPrimitive.Icon></SelectPrimitive.Trigger>
        <SelectPrimitive.Portal><SelectPrimitive.Content className="z-50 rounded-md border bg-background shadow-md"><SelectPrimitive.Viewport className="p-1"><SelectPrimitive.Item value="a" className="rounded-sm px-2 py-1.5 text-sm"><SelectPrimitive.ItemText>А</SelectPrimitive.ItemText></SelectPrimitive.Item><SelectPrimitive.Item value="b" className="rounded-sm px-2 py-1.5 text-sm"><SelectPrimitive.ItemText>Б</SelectPrimitive.ItemText></SelectPrimitive.Item></SelectPrimitive.Viewport></SelectPrimitive.Content></SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      <Badge variant="secondary">бейдж</Badge>
      <PopoverPrimitive.Root>
        <PopoverPrimitive.Trigger asChild><Button variant="outline">Поповер</Button></PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal><PopoverPrimitive.Content className="z-50 w-72 rounded-md border bg-background p-4 shadow-md">поповер</PopoverPrimitive.Content></PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
