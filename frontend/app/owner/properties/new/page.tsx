"use client";

import { OwnerPage } from "@/components/owner/OwnerPage";
import { PropertyWizard } from "@/components/owner/PropertyWizard";

export default function NewPropertyPage() {
  return (
    <OwnerPage title="ثبت اقامتگاه">
      <PropertyWizard mode="create" />
    </OwnerPage>
  );
}
