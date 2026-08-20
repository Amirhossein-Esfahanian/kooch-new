import { notFound } from "next/navigation";
import { DatePickerTestSurface } from "@/components/dev/DatePickerTestSurface";

export default function DatePickerTestPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return <DatePickerTestSurface />;
}
