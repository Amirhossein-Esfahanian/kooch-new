"use client";

import { KoochDialog } from "@/components/KoochDialog";
import { KoochAuthForm } from "@/components/auth/KoochAuthForm";

type KoochGuestAuthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegister?: () => void;
};

export function KoochGuestAuthDialog({
  open,
  onOpenChange,
  onRegister,
}: KoochGuestAuthDialogProps) {
  return (
    <KoochDialog
      open={open}
      onOpenChange={onOpenChange}
      title="ورود یا ثبت‌نام"
      description="برای ادامه، روش ورود به حساب کاربری را انتخاب کنید."
      className="!h-auto max-h-[90vh] sm:max-w-[480px]"
      bodyClassName="py-4"
    >
      <KoochAuthForm context="guest" onRegister={onRegister} />
    </KoochDialog>
  );
}
