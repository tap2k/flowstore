import { useState } from "react";
import {
  ArrowCounterClockwise,
  Copy,
  Gear,
  MagnifyingGlass,
  Play,
  Trash,
  Wrench,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Checkbox,
  CodeBlock,
  DataChip,
  Dialog,
  DropdownMenu,
  FieldRow,
  Icon,
  IconButton,
  Input,
  Kbd,
  MetricStat,
  Panel,
  Select,
  StatusIcon,
  Switch,
  Tabs,
  Textarea,
  ThemeToggle,
  Toast,
  Tooltip,
  type Status,
} from "./index";
import { useThemeStore } from "@/lib/store/theme";

// Kitchen sink for the design-system foundation, mounted at /create/?ds (see main.tsx).
// It is the fastest way to see every atom in both themes at once, and it doubles
// as the reference for the chrome retrofit that comes next.

const NEUTRALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const STATUSES: Status[] = [
  "idle",
  "queued",
  "running",
  "success",
  "error",
  "warning",
  "disabled",
  "breakpoint",
];
const STATE_TOKENS = ["idle", "running", "success", "error", "warning", "disabled"] as const;

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="fs-panelHeader text-text-tertiary">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export function Preview() {
  const resolved = useThemeStore((s) => s.resolved);
  const preference = useThemeStore((s) => s.preference);
  const [tab, setTab] = useState("canvas");
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="fs-root min-h-screen p-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="fs-display text-text-primary">Flowstore design system</h1>
            <p className="fs-body mt-1 text-text-secondary">
              Foundation layer — tokens, Geist, Phosphor icons, core atoms.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="fs-caption text-text-tertiary tabular">
              {preference} → {resolved}
            </span>
            <ThemeToggle />
          </div>
        </header>

        <Row title="Type scale">
          <div className="flex w-full flex-col gap-1">
            <span className="fs-display text-text-primary">Display 28/640</span>
            <span className="fs-pageTitle text-text-primary">Page title 20/560</span>
            <span className="fs-sectionTitle text-text-primary">Section title 16/500</span>
            <span className="fs-body text-text-primary">Body 14/450 — prose, help text</span>
            <span className="fs-ui text-text-primary">UI default 13/450 — the workhorse</span>
            <span className="fs-caption text-text-tertiary">Caption 12/450 — metadata</span>
            <span className="fs-micro text-text-tertiary">MICRO 11/500 — badges, ports</span>
            {/* Prose vs machine text, no second typeface: tracking flips sign,
                weight rises, size falls, container appears. */}
            <span className="fs-code mt-2 text-text-primary">
              {'{"intent":"book_appt","confidence":0.94}'}
            </span>
          </div>
        </Row>

        <Row title="Neutral ramp">
          {NEUTRALS.map((n) => (
            <div key={n} className="flex flex-col items-center gap-1">
              <div
                className="size-10 rounded-2 border border-border-default"
                style={{ background: `var(--n-${n})` }}
              />
              <span className="fs-micro text-text-tertiary tabular">n-{n}</span>
            </div>
          ))}
        </Row>

        <Row title="Functional state">
          {STATE_TOKENS.map((s) => (
            <div key={s} className="flex flex-col items-center gap-1">
              <div
                className="flex size-10 items-center justify-center rounded-2 border"
                style={{
                  background: `var(--state-${s}-bg)`,
                  borderColor: `var(--state-${s}-line)`,
                  color: `var(--state-${s}-fg)`,
                }}
              >
                <Icon icon={Wrench} size="sm" />
              </div>
              <span className="fs-micro text-text-tertiary">{s}</span>
            </div>
          ))}
        </Row>

        <Row title="Status glyphs">
          {STATUSES.map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <StatusIcon status={s} size={16} />
              <span className="fs-caption text-text-secondary">{s}</span>
            </div>
          ))}
        </Row>

        <Row title="Buttons">
          <Button variant="primary" icon={Play}>
            Run test
          </Button>
          <Button variant="secondary" icon={Copy}>
            Duplicate
          </Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive" icon={Trash}>
            Delete flow
          </Button>
          <Button loading>Publishing</Button>
          <Button disabled>Unavailable</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </Row>

        <Row title="Icon buttons">
          <IconButton icon={Play} label="Run" />
          <IconButton icon={Play} label="Run" variant="primary" />
          <IconButton icon={Play} label="Saving" loading />
          <IconButton icon={Gear} label="Settings" active />
          <IconButton icon={Trash} label="Delete" disabled />
          <IconButton icon={ArrowCounterClockwise} label="Undo" size="canvas" />
          <Tooltip label="Fit to view" shortcut="Shift+1">
            <IconButton icon={MagnifyingGlass} label="Fit to view" />
          </Tooltip>
          <DropdownMenu
            trigger={<Button iconRight={Gear}>Menu</Button>}
            items={[
              { header: "Flow" },
              { label: "Duplicate", icon: Copy, shortcut: "Cmd+D", onSelect: () => {} },
              { label: "Undo", icon: ArrowCounterClockwise, shortcut: "Cmd+Z", checked: true },
              { separator: true },
              { label: "Delete", icon: Trash, tone: "destructive", onSelect: () => {} },
            ]}
          />
        </Row>

        <Row title="Inputs">
          <Input placeholder="Flow name" className="w-52" />
          <Input icon={MagnifyingGlass} placeholder="Search" className="w-40" />
          <Input defaultValue="3000" mono suffix="ms" className="w-28" />
          <Input defaultValue="bad value" invalid className="w-32" />
          <Select options={["gpt-4o-mini", "gemini-2.5-flash"]} mono defaultValue="gpt-4o-mini" />
          <Checkbox
            label="Trace every turn"
            hint="Adds ~40 ms per turn"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <Switch label="Live mode" checked={on} onChange={(e) => setOn(e.target.checked)} />
        </Row>

        <Row title="Data">
          <DataChip>gpt-4o-mini</DataChip>
          <DataChip label="temperature:">0.7</DataChip>
          <DataChip tone="error">502</DataChip>
          <Badge status="running">running</Badge>
          <Badge status="success">passed</Badge>
          <Badge status="error">failed</Badge>
          <Kbd>Cmd+K</Kbd>
          <MetricStat label="p95 latency" value="412" unit="ms" delta="+38 ms vs last run" />
          <MetricStat label="Tokens" value="1,204" tone="success" />
        </Row>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Properties">
            <FieldRow label="Flow name" hint="Shown on the canvas node">
              <Input defaultValue="Qualify caller" className="w-full" />
            </FieldRow>
            <FieldRow label="Timeout" required help="Per-turn ceiling, not total">
              <Input defaultValue="3000" mono suffix="ms" className="w-32" />
            </FieldRow>
            <FieldRow label="Retries" error="Must be between 0 and 5">
              <Input defaultValue="9" mono invalid className="w-20" />
            </FieldRow>
            <FieldRow label="Enabled" inline>
              <Switch checked={on} onChange={(e) => setOn(e.target.checked)} />
            </FieldRow>
          </Panel>

          <Panel title="Run log" flush>
            <Tabs
              items={[
                { value: "canvas", label: "Payload" },
                { value: "prompt", label: "Prompt", count: 2 },
              ]}
              value={tab}
              onChange={setTab}
              className="px-2"
            />
            <div className="p-3">
              <CodeBlock
                label="response body"
                lineNumbers
                maxHeight={180}
                code={`{\n  "intent": "book_appt",\n  "slots": {\n    "date": "2026-08-02",\n    "party_size": 4\n  },\n  "latency_ms": 412\n}`}
              />
            </div>
          </Panel>
        </div>

        <Row title="Overlays">
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Toast status="success" message="3 nodes deleted" actionLabel="Undo" onDismiss={() => {}} />
          <Toast status="error" message="Deploy failed" onDismiss={() => {}} />
        </Row>

        <Row title="Textarea">
          <Textarea className="w-full" placeholder="System prompt" rows={3} />
          <Textarea
            className="w-full"
            code
            rows={3}
            defaultValue={'if (retries != 3) => escalate("human")'}
          />
        </Row>

        <Row title="Canvas plane">
          <div className="fs-canvas h-32 w-full rounded-3 border border-border-default" />
        </Row>

        <Dialog
          open={dialogOpen}
          title="Delete 4 nodes?"
          description="Their connections will be removed. This can't be undone."
          onClose={() => setDialogOpen(false)}
          footer={
            <>
              <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => setDialogOpen(false)}>
                Delete nodes
              </Button>
            </>
          }
        />
      </div>
    </div>
  );
}
