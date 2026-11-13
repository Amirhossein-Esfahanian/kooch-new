"use client";

import { KoochDialog } from "@/components/KoochDialog";
import { KoochUserProfileForm } from "@/components/KoochUserProfileForm";
import { UserProfileAvatarProvider } from "@/components/auth/UserProfileAvatarProvider";

export function KoochUserProfileDialog({ open, onOpenChange }: {
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  return <UserProfileAvatarProvider>
    <KoochUserProfileForm active={open} onCancel={() => onOpenChange(false)} onSaved={() => onOpenChange(false)}>
      {({ form, actions }) => <KoochDialog
        description="اطلاعات حساب و روش‌های دریافت اعلان‌ها را مدیریت کنید."
        footer={actions} onOpenChange={onOpenChange} open={open} size="md" title="پروفایل کاربر"
      >{form}</KoochDialog>}
    </KoochUserProfileForm>
  </UserProfileAvatarProvider>;
}
