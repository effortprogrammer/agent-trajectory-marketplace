import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { Media } from "@higgsfield/quanta/media";
import { Modal } from "@higgsfield/quanta/modal";
import { Typography } from "@higgsfield/quanta/typography";
import { cn } from "@/lib/utils";

/**
 * TemplateModal — the "All Presets" picker (Figma SC App Builder, node
 * 3117:143969). A glass `Modal` whose body is a plain grid of selectable option
 * tiles: each a preview image with a label underneath, the active one ringed by
 * the lime brand border. Distinct from the Studio `TemplatePickerModal` (which
 * is a tabbed/searchable gallery of triptych cards) — this is the generic
 * "choose a template / preset / animal / option set" chooser, so any trigger
 * that implies picking one option from a set can reuse it via `trigger`, exactly
 * like `AssetLibraryModal`.
 *
 *   <TemplateModal
 *     title="Select Animal"
 *     options={ANIMALS}
 *     defaultValue="deer"
 *     onSelect={handleSelect}
 *     trigger={<Dropzone render={<button type="button" />} … />}
 *   />
 *
 * Quanta components + `q-` tokens only.
 */

export interface TemplateOption {
  /** Stable id used for selection + React keys. */
  id: string;
  /** Label shown beneath the preview. */
  label: string;
  /** Preview image source. */
  image: string;
  /** Alt text for the preview (defaults to `label`). */
  alt?: string;
}

const COLUMN_CLASS = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
} as const;

export type TemplateModalColumns = keyof typeof COLUMN_CLASS;

export interface TemplateModalProps {
  /** The trigger element (e.g. a `Dropzone`/button). Rendered as the Modal trigger. */
  trigger: ReactElement;
  /** Selectable option tiles. */
  options: TemplateOption[];
  /** Header title. */
  title?: ReactNode;
  /** Controlled selected id. */
  value?: string;
  /** Uncontrolled initial selected id. */
  defaultValue?: string;
  /** Fired when a tile is chosen. */
  onSelect?: (option: TemplateOption) => void;
  /** Grid columns (default 4, matching Figma). */
  columns?: TemplateModalColumns;
  /** Close the modal once an option is chosen (default true). */
  closeOnSelect?: boolean;
  /** Start opened (uncontrolled) — handy for previews. */
  defaultOpen?: boolean;
}

interface OptionCardProps {
  option: TemplateOption;
  selected: boolean;
  closeOnSelect: boolean;
  onSelect: (option: TemplateOption) => void;
}

/** A single selectable preset tile — preview + label, lime-ringed when active. */
function OptionCard({ option, selected, closeOnSelect, onSelect }: OptionCardProps) {
  const className = cn(
    "group flex flex-col gap-2 rounded-q-600 text-left transition-transform",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-q-border-focus",
  );
  const children = (
    <>
      <Media
        ratio="auto"
        rounded="md"
        className={cn(
          "h-60 w-full border-2 bg-q-background-secondary transition-colors",
          selected
            ? "border-q-brand-primary"
            : "border-transparent group-hover:border-q-border-strong",
        )}
      >
        <Media.Image src={option.image} alt={option.alt ?? option.label} />
      </Media>
      <Typography as="span" variant="body-md-semi-bold" color="primary" truncate className="px-0.5">
        {option.label}
      </Typography>
    </>
  );

  const handleClick = () => onSelect(option);

  return closeOnSelect ? (
    <Modal.Close className={className} onClick={handleClick} aria-pressed={selected}>
      {children}
    </Modal.Close>
  ) : (
    <button type="button" className={className} onClick={handleClick} aria-pressed={selected}>
      {children}
    </button>
  );
}

export function TemplateModal({
  trigger,
  options,
  title = "All Presets",
  value,
  defaultValue,
  onSelect,
  columns = 4,
  closeOnSelect = true,
  defaultOpen,
}: TemplateModalProps) {
  const [internal, setInternal] = useState(defaultValue);
  const selectedId = value ?? internal;

  const handleSelect = (option: TemplateOption) => {
    if (value === undefined) setInternal(option.id);
    onSelect?.(option);
  };

  return (
    <Modal.Root defaultOpen={defaultOpen}>
      <Modal.Trigger render={trigger} />
      <Modal.Content size="xl">
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn("grid gap-5 p-1", COLUMN_CLASS[columns])}>
            {options.map((option) => (
              <OptionCard
                key={option.id}
                option={option}
                selected={option.id === selectedId}
                closeOnSelect={closeOnSelect}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
