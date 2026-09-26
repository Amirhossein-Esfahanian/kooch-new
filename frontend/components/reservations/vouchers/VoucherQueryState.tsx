import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";

export function VoucherQueryState({ status, message, retry }: {
  status: "loading" | "missing" | "error";
  message?: string;
  retry: () => void;
}) {
  if (status === "loading") return (
    <KoochCard role="status"><p>در حال دریافت ووچر...</p></KoochCard>
  );
  if (status === "missing") return (
    <KoochAlert role="status">برای این رزرو هنوز ووچری صادر نشده است.</KoochAlert>
  );
  return (
    <KoochAlert variant="destructive">
      <p>{message}</p>
      <KoochButton onClick={retry} variant="outline">تلاش دوباره</KoochButton>
    </KoochAlert>
  );
}
