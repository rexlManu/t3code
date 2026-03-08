export const modalBackdropClassName =
  "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-all duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0";

export const modalViewportClassName =
  "fixed inset-0 z-50 flex items-center justify-center p-4";

export const modalViewportBottomStickClassName =
  "max-sm:items-end max-sm:p-0 max-sm:pt-12";

export const modalPopupClassName =
  "-translate-y-[calc(1rem*var(--nested-dialogs))] relative flex max-h-full min-h-0 w-full min-w-0 scale-[calc(1-0.06*var(--nested-dialogs))] flex-col overflow-hidden rounded-[1rem] border border-border bg-popover text-popover-foreground opacity-[calc(1-0.08*var(--nested-dialogs))] shadow-lg/10 outline-none transition-[scale,opacity,translate] duration-200 ease-out will-change-transform data-nested:data-ending-style:translate-y-6 data-nested:data-starting-style:translate-y-6 data-nested-dialog-open:origin-top data-ending-style:scale-97 data-starting-style:scale-97 data-ending-style:opacity-0 data-starting-style:opacity-0";

export const modalPopupBottomStickClassName =
  "max-sm:max-w-none max-sm:rounded-t-[1.1rem] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4 max-sm:before:rounded-none";

export const modalCommandViewportClassName =
  "fixed inset-0 z-50 flex items-center justify-center p-4";
