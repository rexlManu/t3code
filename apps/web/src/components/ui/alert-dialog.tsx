"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { cn } from "~/lib/utils";
import {
  modalBackdropClassName,
  modalPopupBottomStickClassName,
  modalPopupClassName,
  modalViewportBottomStickClassName,
  modalViewportClassName,
} from "./overlayStyles";

const AlertDialogCreateHandle = AlertDialogPrimitive.createHandle;

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

function AlertDialogTrigger(props: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogBackdrop({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      className={cn(modalBackdropClassName, className)}
      data-slot="alert-dialog-backdrop"
      {...props}
    />
  );
}

function AlertDialogViewport({ className, ...props }: AlertDialogPrimitive.Viewport.Props) {
  return (
    <AlertDialogPrimitive.Viewport
      className={cn(modalViewportClassName, className)}
      data-slot="alert-dialog-viewport"
      {...props}
    />
  );
}

function AlertDialogPopup({
  className,
  bottomStickOnMobile = true,
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  bottomStickOnMobile?: boolean;
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogBackdrop />
      <AlertDialogViewport className={cn(bottomStickOnMobile && modalViewportBottomStickClassName)}>
        <AlertDialogPrimitive.Popup
          className={cn(
            modalPopupClassName,
            "max-w-lg",
            bottomStickOnMobile && modalPopupBottomStickClassName,
            className,
          )}
          data-slot="alert-dialog-popup"
          {...props}
        />
      </AlertDialogViewport>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "bg-popover flex flex-col gap-2 p-6 pb-4 text-center max-sm:px-5 max-sm:pt-5 sm:text-left",
        className,
      )}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end sm:rounded-b-[calc(1rem-1px)] max-sm:px-5",
        variant === "default" && "border-t border-border bg-muted py-4",
        variant === "bare" && "pb-6",
        className,
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("text-base font-semibold text-foreground", className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-sm leading-6 text-muted-foreground", className)}
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />;
}

export {
  AlertDialogCreateHandle,
  AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogBackdrop as AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogPopup,
  AlertDialogPopup as AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
  AlertDialogViewport,
};
