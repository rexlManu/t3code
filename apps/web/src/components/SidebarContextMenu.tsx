import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
} from "~/components/ui/menu";

export type SidebarContextMenuEntry<T extends string> =
  | {
      type: "section";
      label: string;
    }
  | {
      type: "item";
      id: T;
      label: string;
      icon: LucideIcon;
    };

interface SidebarContextMenuProps<T extends string> {
  open: boolean;
  position: { x: number; y: number } | null;
  entries: readonly SidebarContextMenuEntry<T>[];
  onOpenChange: (open: boolean) => void;
  onSelect: (id: T) => void;
}

export function SidebarContextMenu<T extends string>({
  open,
  position,
  entries,
  onOpenChange,
  onSelect,
}: SidebarContextMenuProps<T>) {
  const sections = useMemo(() => {
    const nextSections: Array<{
      label: string | null;
      items: Array<Extract<SidebarContextMenuEntry<T>, { type: "item" }>>;
    }> = [];
    let currentLabel: string | null = null;
    let currentGroup: Array<Extract<SidebarContextMenuEntry<T>, { type: "item" }>> = [];

    const pushCurrentGroup = () => {
      if (currentGroup.length === 0) return;
      nextSections.push({
        label: currentLabel,
        items: currentGroup,
      });
      currentGroup = [];
    };

    for (const entry of entries) {
      if (entry.type === "section") {
        pushCurrentGroup();
        currentLabel = entry.label;
        continue;
      }

      currentGroup.push(entry);
    }

    pushCurrentGroup();

    return nextSections;
  }, [entries]);

  return (
    <Menu
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onOpenChange(false);
        }
      }}
      open={open && position !== null}
    >
      <MenuPopup
        align="start"
        anchor={() =>
          position
            ? {
                getBoundingClientRect: () => new DOMRect(position.x, position.y, 0, 0),
              }
            : null
        }
        className="w-56 overflow-hidden rounded border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl shadow-background/30 before:hidden"
        positionMethod="fixed"
        side="bottom"
        sideOffset={6}
      >
        {sections.map((section, sectionIndex) => {
          const sectionKey = `${section.label ?? "section"}-${section.items[0]?.id ?? sectionIndex}`;

          return (
            <div key={sectionKey} className={sectionIndex > 0 ? "pt-1" : undefined}>
              <MenuGroup>
                {section.label ? (
                  <MenuGroupLabel
                    className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-[0.04em] text-sidebar-foreground/45 uppercase"
                  >
                    {section.label}
                  </MenuGroupLabel>
                ) : null}
                {section.items.map((entry) => {
                  const Icon = entry.icon;

                  return (
                    <MenuItem
                      key={entry.id}
                      className="min-h-7 rounded px-2 text-[11px] font-medium text-sidebar-foreground/80 data-highlighted:bg-sidebar-accent data-highlighted:text-sidebar-accent-foreground sm:text-[11px] [&>svg]:size-3.5 [&>svg]:text-sidebar-foreground/55"
                      onClick={() => onSelect(entry.id)}
                      variant="default"
                    >
                      <Icon aria-hidden="true" />
                      {entry.label}
                    </MenuItem>
                  );
                })}
              </MenuGroup>
            </div>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}
