import type { MouseEvent, ReactNode } from "react";
import { EllipsisVertical as IconMoreVertical } from "lucide-react";
import { Dropdown } from "@higgsfield/quanta/dropdown";
import { Icon, type IconGlyph } from "@higgsfield/quanta/icon";

/**
 * CardActions — the hover-revealed action rail for a gallery tile (heart /
 * download / copy / share …). It enforces ONE rule: a card shows at most
 * `max` (default 3) affordances. When there are more actions than that, only
 * the first `max - 1` render as glass icon buttons and the remainder collapse
 * into a trailing three-dots (`EllipsisVertical`) overflow menu — so a tile never
 * shows more than `max` controls.
 *
 * It is presentation-only and composition-first: the host passes the action
 * list, this component decides what stays inline vs. what goes in the menu.
 * Render it as a child of a `.group` tile; the rail fades in on hover / focus.
 *
 * The rail is a passive layer (`pointer-events-none`) so its empty space never
 * blocks the tile's underlying open-detail trigger — only the buttons
 * themselves are interactive. Each handler stops propagation so a click acts on
 * the tile action, not the card.
 */

export interface CardAction {
  /** Stable id — React key + menu row value. */
  id: string;
  /** Accessible label (button `aria-label` + menu row title). */
  label: string;
  /** Leading glyph. */
  icon: IconGlyph;
  /** Invoked on click / menu select. */
  onSelect?: () => void;
  /** Destructive row — red styling inside the overflow menu. */
  danger?: boolean;
}

export interface CardActionsProps {
  actions: CardAction[];
  /** Hard cap on visible affordances (buttons + the more-menu). Default 3. */
  max?: number;
}

/** Glass circular icon button shared by the inline actions and the more-trigger. */
const GLASS_BUTTON =
  "pointer-events-auto flex size-8 shrink-0 items-center justify-center rounded-q-full bg-q-transparent-dark-40 text-q-icon-primary backdrop-blur-md transition-colors hover:bg-q-transparent-dark-60 focus-visible:outline-2 focus-visible:outline-q-border-focus";

function stop(event: MouseEvent) {
  event.stopPropagation();
}

/** One inline glass icon button. */
function ActionButton({ action }: { action: CardAction }) {
  return (
    <button
      type="button"
      aria-label={action.label}
      className={GLASS_BUTTON}
      onPointerDown={stop}
      onClick={(event) => {
        event.stopPropagation();
        action.onSelect?.();
      }}
    >
      <Icon as={action.icon} size="sm" />
    </button>
  );
}

/** The overflow menu — a three-dots trigger over a Dropdown of the extra rows. */
function MoreMenu({ actions }: { actions: CardAction[] }): ReactNode {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        aria-label="More actions"
        className={GLASS_BUTTON}
        onPointerDown={stop}
        onClick={stop}
      >
        <Icon as={IconMoreVertical} size="sm" />
      </Dropdown.Trigger>
      <Dropdown.Content surface="solid" side="bottom" align="end" sideOffset={6}>
        {actions.map((action) => (
          <Dropdown.Item
            key={action.id}
            value={action.id}
            danger={action.danger}
            start={<Icon as={action.icon} size="sm" />}
            title={action.label}
            onSelect={() => action.onSelect?.()}
          />
        ))}
      </Dropdown.Content>
    </Dropdown.Root>
  );
}

export function CardActions({ actions, max = 3 }: CardActionsProps) {
  if (actions.length === 0) return null;

  // At most `max` controls: everything fits, OR (max - 1) buttons + a more-menu.
  const overflow = actions.length > max;
  const inline = overflow ? actions.slice(0, max - 1) : actions;
  const extra = overflow ? actions.slice(max - 1) : [];

  return (
    <div className="pointer-events-none absolute right-2 top-2 z-[2] flex flex-col items-center gap-1.5 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
      {inline.map((action) => (
        <ActionButton key={action.id} action={action} />
      ))}
      {extra.length > 0 ? <MoreMenu actions={extra} /> : null}
    </div>
  );
}
