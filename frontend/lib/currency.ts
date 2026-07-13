"use client";

import { useEffect, useState } from "react";
import {
  defaultSiteSettings,
  fetchPublicSiteSettings,
  mergeSiteSettings,
  settingValue,
} from "@/lib/site-settings";

export const defaultCurrencyLabel =
  defaultSiteSettings["pricing.currencyLabel"];

type CurrencyFormatOptions = {
  currencyLabel?: string;
  showCurrency?: boolean;
};

let currencyLabelRequest: Promise<string> | null = null;

function fetchSiteCurrencyLabel() {
  currencyLabelRequest ??= fetchPublicSiteSettings()
    .then((settings) =>
      settingValue(mergeSiteSettings(settings), "pricing.currencyLabel"),
    )
    .catch(() => defaultCurrencyLabel);

  return currencyLabelRequest;
}

export function formatCurrency(
  value?: number | null,
  options: CurrencyFormatOptions = {},
) {
  if (value === null || value === undefined) return "-";

  const formatted = new Intl.NumberFormat("fa-IR").format(value);
  if (options.showCurrency === false) return formatted;

  const currencyLabel = options.currencyLabel ?? defaultCurrencyLabel;
  return currencyLabel ? `${formatted} ${currencyLabel}` : formatted;
}

export function useSiteCurrencyLabel() {
  const [currencyLabel, setCurrencyLabel] = useState(defaultCurrencyLabel);

  useEffect(() => {
    let active = true;
    void fetchSiteCurrencyLabel().then((label) => {
      if (active) setCurrencyLabel(label);
    });

    return () => {
      active = false;
    };
  }, []);

  return currencyLabel;
}
