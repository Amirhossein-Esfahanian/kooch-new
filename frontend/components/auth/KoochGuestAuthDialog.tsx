"use client";

import { KoochDialog } from "@/components/KoochDialog";
import { KoochGuestAuthFlow } from "@/components/auth/KoochGuestAuthFlow";

type KoochGuestAuthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function KoochGuestAuthDialog({
  open,
  onOpenChange,
}: KoochGuestAuthDialogProps) {
  return (
    <KoochDialog
      open={open}
      onOpenChange={onOpenChange}
      className="!h-auto max-h-[90vh] sm:max-w-[480px]"
      bodyClassName="py-4"
      size="md"
    >
      <KoochGuestAuthFlow />
    </KoochDialog>
  );
}
