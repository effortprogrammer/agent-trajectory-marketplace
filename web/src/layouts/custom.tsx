"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  GearSix as NavigationSettings,
  Pulse as NavigationActivity,
  Sparkle as NavigationGenerations,
  SquaresFour as NavigationOverview,
} from "@phosphor-icons/react";
import { Button } from "@higgsfield/quanta/button";
import { Icon } from "@higgsfield/quanta/icon";
import type { IconGlyph } from "@higgsfield/quanta/icon";
import { Input } from "@higgsfield/quanta/input";
import { Modal } from "@higgsfield/quanta/modal";
import { Typography } from "@higgsfield/quanta/typography";
import { PromptBox } from "@/components/prompt-box";
import { UserGenerations } from "@/components/user-generations";
import {
  CustomAppShell,
  EmptyState,
  MetricCard,
  Page,
  PageHeader,
  Panel,
  Section,
  VolumetricIconTile,
  WorkspaceContent,
} from "@/components/custom-ui";
import type { NavigationItem } from "@/components/custom-ui";

const NAVIGATION = [
  { id: "overview", label: "Overview", icon: NavigationOverview, gradient: "blue" },
  {
    id: "generations",
    label: "Generations",
    icon: NavigationGenerations,
    gradient: "green",
  },
  { id: "activity", label: "Activity", icon: NavigationActivity, gradient: "purple" },
  { id: "settings", label: "Settings", icon: NavigationSettings, gradient: "orange" },
] satisfies NavigationItem[];

interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  icon: IconGlyph;
}

const INITIAL_ACTIVITY: ActivityItem[] = [
  { id: "1", title: "First workflow completed", detail: "A few minutes ago", icon: CheckCircle2 },
  { id: "2", title: "New item added", detail: "Today", icon: Plus },
  { id: "3", title: "Workspace updated", detail: "Yesterday", icon: Sparkles },
];

function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Meaningful changes will appear here when work begins."
      />
    );
  }

  return (
    <div className="divide-y divide-q-border-subtle">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <VolumetricIconTile icon={item.icon} size="sm" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Typography as="span" variant="body-sm-medium" color="primary" truncate>
              {item.title}
            </Typography>
            <Typography as="span" variant="caption-sm-regular" color="tertiary">
              {item.detail}
            </Typography>
          </div>
        </div>
      ))}
    </div>
  );
}

function NewItemModal({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const trimmedName = name.trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmedName) return;
    onCreate(trimmedName);
    setName("");
    setOpen(false);
  };

  return (
    <Modal.Root open={open} onOpenChange={setOpen}>
      <Modal.Trigger
        render={
          <Button variant="secondary" size="sm" start={<Icon as={Plus} size="sm" />}>
            New item
          </Button>
        }
      />
      <Modal.Content size="sm">
        <Modal.Header>
          <Modal.Title>Create item</Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          <form id="new-item-form" onSubmit={handleSubmit}>
            <Input
              required
              autoFocus
              label="Name"
              placeholder="Give it a clear name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </form>
        </Modal.Body>
        <Modal.Footer>
          <Modal.FooterActions>
            <Modal.Close render={<Button variant="ghost" size="sm" />}>Cancel</Modal.Close>
            <Button
              type="submit"
              form="new-item-form"
              variant="secondary"
              size="sm"
              disabled={!trimmedName}
            >
              Create
            </Button>
          </Modal.FooterActions>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

function Overview({
  activity,
  onCreate,
  onOpenActivity,
}: {
  activity: ActivityItem[];
  onCreate: (name: string) => void;
  onOpenActivity: () => void;
}) {
  return (
    <Page>
      <PageHeader
        eyebrow="Workspace overview"
        title="Keep your workspace moving"
        description="Track progress and move the most important work forward."
        actions={<NewItemModal onCreate={onCreate} />}
      />

      <Section title="At a glance" description="A concise view of current performance.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard icon={BarChart3} label="Completed" value="128" badge="+12" />
          <MetricCard icon={Clock3} label="In progress" value="8" badge="3 due" />
          <MetricCard icon={FolderOpen} label="Collections" value="24" badge="Today" />
        </div>
      </Section>

      <Section
        title="Recent activity"
        description="Only the latest changes appear here."
        actions={
          <Button variant="ghost" size="xs" onClick={onOpenActivity}>
            View all
          </Button>
        }
      >
        <Panel>
          <ActivityList items={activity.slice(0, 3)} />
        </Panel>
      </Section>
    </Page>
  );
}

function ActivityView({
  activity,
  onCreate,
}: {
  activity: ActivityItem[];
  onCreate: (name: string) => void;
}) {
  return (
    <Page>
      <PageHeader
        title="Activity"
        description="Review recent changes across your workspace."
        actions={<NewItemModal onCreate={onCreate} />}
      />
      <Section title="Latest changes">
        <Panel>
          <ActivityList items={activity} />
        </Panel>
      </Section>
    </Page>
  );
}

function SettingsFields({
  workspaceName,
  onWorkspaceNameChange,
}: {
  workspaceName: string;
  onWorkspaceNameChange: (value: string) => void;
}) {
  return (
    <Input
      label="Workspace name"
      value={workspaceName}
      onChange={(event) => onWorkspaceNameChange(event.target.value)}
    />
  );
}

function SettingsView({
  workspaceName,
  onWorkspaceNameChange,
  onSave,
  saved,
}: {
  workspaceName: string;
  onWorkspaceNameChange: (value: string) => void;
  onSave: () => void;
  saved: boolean;
}) {
  return (
    <Page>
      <PageHeader title="Settings" description="Manage the details that shape this workspace." />
      <Section title="Workspace">
        <Panel className="flex flex-col gap-4">
          <SettingsFields
            workspaceName={workspaceName}
            onWorkspaceNameChange={onWorkspaceNameChange}
          />
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" disabled={saved} onClick={onSave}>
              Save changes
            </Button>
          </div>
        </Panel>
      </Section>
    </Page>
  );
}

function GenerationsWorkspace({
  prompt,
  generating,
  onPromptChange,
  onGenerateToggle,
}: {
  prompt: string;
  generating: boolean;
  onPromptChange: (value: string) => void;
  onGenerateToggle: () => void;
}) {
  return (
    <WorkspaceContent mode="generations" className="pb-36">
      <UserGenerations demo />
      <div className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-center">
        <PromptBox.Root surface="glass" className="pointer-events-auto w-[900px] max-w-full">
          <PromptBox.Body>
            <PromptBox.Field
              aria-label="Generation prompt"
              placeholder="Describe what you want to generate..."
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </PromptBox.Body>
          <PromptBox.Generate
            disabled={!generating && prompt.trim().length === 0}
            onClick={onGenerateToggle}
          >
            {generating ? "Cancel" : "Generate"}
          </PromptBox.Generate>
        </PromptBox.Root>
      </div>
    </WorkspaceContent>
  );
}

export function CustomTemplate({ previewMode = false }: { previewMode?: boolean }) {
  const [activeId, setActiveId] = useState("overview");
  const [activity, setActivity] = useState<ActivityItem[]>(INITIAL_ACTIVITY);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("Custom workspace");
  const [savedWorkspaceName, setSavedWorkspaceName] = useState(workspaceName);

  const handleCreate = (name: string) => {
    setActivity((current) => [
      {
        id: crypto.randomUUID(),
        title: `${name} created`,
        detail: "Just now",
        icon: Plus,
      },
      ...current,
    ]);
  };

  return (
    <div
      className="h-dvh"
      data-app-preview={previewMode ? "true" : undefined}
      inert={previewMode ? true : undefined}
    >
      <CustomAppShell
        brand="Custom App"
        navigation={NAVIGATION}
        activeId={activeId}
        onNavigate={setActiveId}
      >
        {activeId === "generations" ? (
          <GenerationsWorkspace
            prompt={prompt}
            generating={generating}
            onPromptChange={setPrompt}
            onGenerateToggle={() => setGenerating((current) => !current)}
          />
        ) : (
          <WorkspaceContent mode="page">
            {activeId === "overview" ? (
              <Overview
                activity={activity}
                onCreate={handleCreate}
                onOpenActivity={() => setActiveId("activity")}
              />
            ) : activeId === "activity" ? (
              <ActivityView activity={activity} onCreate={handleCreate} />
            ) : (
              <SettingsView
                workspaceName={workspaceName}
                onWorkspaceNameChange={setWorkspaceName}
                onSave={() => setSavedWorkspaceName(workspaceName)}
                saved={!workspaceName.trim() || workspaceName === savedWorkspaceName}
              />
            )}
          </WorkspaceContent>
        )}
      </CustomAppShell>
    </div>
  );
}
