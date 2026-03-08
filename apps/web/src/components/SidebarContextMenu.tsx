import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";

import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
} from "~/components/ui/menu";
import { cn } from "~/lib/utils";

export type SidebarContextMenuEntry<T extends string> =
  | {
      type: "item";
      id: T;
      label: string;
      icon: LucideIcon;
      destructive?: boolean;
    }
  | {
      type: "separator";
    };

interface SidebarContextMenuProps<T extends string> {
  open: boolean;
  position: { x: number; y: number } | null;
  sectionLabel: string;
  title: string;
  entries: readonly SidebarContextMenuEntry<T>[];
  onOpenChange: (open: boolean) => void;
  onSelect: (id: T) => void;
}

export function SidebarContextMenu<T extends string>({
  open,
  position,
  sectionLabel,
  title,
  entries,
  onOpenChange,
  onSelect,
}: SidebarContextMenuProps<T>) {
  const groups = useMemo(() => {
    const nextGroups: Array<Array<Extract<SidebarContextMenuEntry<T>, { type: "item" }>>> = [];
    let currentGroup: Array<Extract<SidebarContextMenuEntry<T>, { type: "item" }>> = [];

    for (const entry of entries) {
      if (entry.type === "separator") {
        if (currentGroup.length > 0) {
          nextGroups.push(currentGroup);
          currentGroup = [];
        }
        continue;
      }

      currentGroup.push(entry);
    }

    if (currentGroup.length > 0) {
      nextGroups.push(currentGroup);
    }

    return nextGroups;
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
        className="w-60 rounded-xl border-sidebar-border/80 bg-sidebar/96 text-sidebar-foreground shadow-[0_24px_80px_-30px_rgba(15,23,42,0.42)] backdrop-blur-xl before:hidden dark:shadow-[0_24px_80px_-30px_rgba(0,0,0,0.72)]"
        positionMethod="fixed"
        side="bottom"
        sideOffset={6}
      >
        <div className="mb-1 rounded-lg border border-sidebar-border/70 bg-linear-to-br from-sidebar-accent/80 via-sidebar-accent/45 to-transparent px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-none">
          <p className="text-[10px] tracking-[0.24em] text-sidebar-foreground/45 uppercase">
            {sectionLabel}
          </p>
          <p className="mt-1 truncate text-sm font-medium text-sidebar-foreground">{title}</p>
        </div>

        {groups.map((group, groupIndex) => {
          const groupKey = `${group[0]?.id ?? sectionLabel}-${group[group.length - 1]?.id ?? groupIndex}`;

          return (
            <div key={groupKey}>
              {groupIndex > 0 ? <MenuSeparator className="mx-0 my-1 bg-sidebar-border/70" /> : null}
              <MenuGroup>
                {group.map((entry) => {
                  const Icon = entry.icon;

                  return (
                    <MenuItem
                      key={entry.id}
                      className={cn(
                        "min-h-9 rounded-md px-2.5 text-sm data-highlighted:bg-sidebar-accent data-highlighted:text-sidebar-accent-foreground",
                        entry.destructive &&
                          "text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive",
                      )}
                      onClick={() => onSelect(entry.id)}
                      variant={entry.destructive ? "destructive" : "default"}
                    >
                      <Icon
                        aria-hidden="true"
                        className={entry.destructive ? "text-destructive/85" : undefined}
                      />
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
