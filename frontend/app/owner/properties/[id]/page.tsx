"use client";

import { useParams } from "next/navigation";
import { OwnerPage } from "@/components/owner/OwnerPage";
import { PropertyWizard } from "@/components/owner/PropertyWizard";

export default function ManagePropertyPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);

  return (
    <OwnerPage title="ویرایش اقامتگاه">
      <PropertyWizard mode="edit" propertyId={propertyId} />
    </OwnerPage>
  );
}
