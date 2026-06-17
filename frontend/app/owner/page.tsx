"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, getToken, ownerPropertyKey, PropertyResponse } from "@/lib/owner-api";

export default function OwnerHomePage() {
  const router = useRouter();
  const [message, setMessage] = useState("در حال آماده‌سازی پنل مالک...");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    apiRequest<PropertyResponse[]>("/owner/properties")
      .then((properties) => {
        if (properties.length === 0) {
          router.replace("/owner/select-property");
          return;
        }
        const selected = localStorage.getItem(ownerPropertyKey);
        const selectedProperty = properties.find((property) => property.id.toString() === selected);
        const property = selectedProperty ?? properties[0];
        localStorage.setItem(ownerPropertyKey, property.id.toString());
        router.replace(`/owner/properties/${property.id}/dashboard`);
      })
      .catch((caught: Error) => setMessage(caught.message));
  }, [router]);

  return <div className="mx-auto max-w-5xl px-5 py-12 text-slate-500" dir="rtl">{message}</div>;
}
