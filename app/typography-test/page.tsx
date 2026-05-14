import { ThemeToggle } from "@/components/theme-toggle";
import { Icon, type IconSize } from "@/components/ui/icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// One row per M3 type token (UI/UX §2.3). Sample text matches Google's M3
// reference page so the rendered output is easy to eyeball against the spec.
const TYPE_SCALE: Array<{
  label: string;
  className: string;
  spec: string;
  sample: string;
}> = [
  { label: "Display Large", className: "text-display-lg", spec: "57 / 64 / -0.25 / Reg", sample: "Beakn Home Visit" },
  { label: "Display Medium", className: "text-display-md", spec: "45 / 52 / 0 / Reg", sample: "Beakn Home Visit" },
  { label: "Display Small", className: "text-display-sm", spec: "36 / 44 / 0 / Reg", sample: "Beakn Home Visit" },
  { label: "Headline Large", className: "text-headline-lg", spec: "32 / 40 / 0 / Reg", sample: "Field operations dashboard" },
  { label: "Headline Medium", className: "text-headline-md", spec: "28 / 36 / 0 / Reg", sample: "Field operations dashboard" },
  { label: "Headline Small", className: "text-headline-sm", spec: "24 / 32 / 0 / Reg", sample: "Field operations dashboard" },
  { label: "Title Large", className: "text-title-lg", spec: "22 / 28 / 0 / Reg", sample: "Scheduled visits this week" },
  { label: "Title Medium", className: "text-title-md font-medium", spec: "16 / 24 / 0.15 / Med", sample: "Scheduled visits this week" },
  { label: "Title Small", className: "text-title-sm font-medium", spec: "14 / 20 / 0.1 / Med", sample: "Scheduled visits this week" },
  { label: "Body Large", className: "text-body-lg", spec: "16 / 24 / 0.5 / Reg", sample: "Visit Mr. Reddy on Friday at 4pm to walk through the proposal." },
  { label: "Body Medium", className: "text-body-md", spec: "14 / 20 / 0.25 / Reg", sample: "Visit Mr. Reddy on Friday at 4pm to walk through the proposal." },
  { label: "Body Small", className: "text-body-sm", spec: "12 / 16 / 0.4 / Reg", sample: "Visit Mr. Reddy on Friday at 4pm to walk through the proposal." },
  { label: "Label Large", className: "text-label-lg font-medium uppercase", spec: "14 / 20 / 0.1 / Med", sample: "Confirm visit" },
  { label: "Label Medium", className: "text-label-md font-medium uppercase", spec: "12 / 16 / 0.5 / Med", sample: "Confirm visit" },
  { label: "Label Small", className: "text-label-sm font-medium uppercase", spec: "11 / 16 / 0.5 / Med", sample: "Confirm visit" },
];

const ICON_SIZES: Array<{ size: IconSize; px: number }> = [
  { size: "xs", px: 16 },
  { size: "sm", px: 20 },
  { size: "md", px: 24 },
  { size: "lg", px: 32 },
  { size: "xl", px: 48 },
];

export default function TypographyTestPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-headline-md">Beakn — typography &amp; icons</h1>
          <p className="text-body-md text-muted-foreground">
            Inter + Material Symbols Rounded, M3 type and icon scales per UI/UX
            §2.3 and §2.4.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>M3 type scale (Inter)</CardTitle>
          <CardDescription>
            Spec columns are <code>size / line-height / tracking / weight</code>{" "}
            in M3 reference units.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {TYPE_SCALE.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-1 gap-2 py-4 sm:grid-cols-[12rem_1fr] sm:items-baseline"
            >
              <div className="space-y-1">
                <div className="text-label-md font-medium uppercase text-muted-foreground">
                  {row.label}
                </div>
                <div className="text-body-sm text-muted-foreground">
                  {row.spec}
                </div>
              </div>
              <div className={row.className}>{row.sample}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Icon size scale (Material Symbols Rounded)</CardTitle>
          <CardDescription>
            16 / 20 / 24 / 32 / 48 dp at default fill, weight 400.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-6">
            {ICON_SIZES.map(({ size, px }) => (
              <div key={size} className="flex flex-col items-center gap-2">
                <Icon name="home" size={size} />
                <div className="text-label-sm font-medium uppercase text-muted-foreground">
                  {size} · {px}dp
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-card border bg-card p-4">
              <Icon name="event" size="lg" />
              <div>
                <div className="text-title-md font-medium">Outline (default)</div>
                <div className="text-body-sm text-muted-foreground">
                  FILL 0, weight 400
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-card border bg-card p-4">
              <Icon name="event" size="lg" fill weight={500} />
              <div>
                <div className="text-title-md font-medium">Filled, weight 500</div>
                <div className="text-body-sm text-muted-foreground">
                  Variable axes wired via <code>fontVariationSettings</code>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
