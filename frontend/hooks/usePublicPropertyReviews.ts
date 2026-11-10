"use client";
import { useEffect, useState } from "react";
import { getPublicPropertyReviews, type PublicReviewPage } from "@/lib/property-reviews";

export function usePublicPropertyReviews(slug: string) {
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<PublicReviewPage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { setPage(1); }, [slug]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") setVersion(value => value + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError(false);
    getPublicPropertyReviews(slug, page, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.reviews.totalPages > 0 && page > result.reviews.totalPages) setPage(result.reviews.totalPages);
      else setData(result);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [slug, page, version]);
  return { data, error, page, setPage, retry: () => setVersion(value => value + 1) };
}
