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
let currentCurrencyLabel = defaultCurrencyLabel;
const currencyLabelListeners = new Set<(label: string) => void>();

function fetchSiteCurrencyLabel() {
  currencyLabelRequest ??= fetchPublicSiteSettings()
    .then((settings) =>
      settingValue(mergeSiteSettings(settings), "pricing.currencyLabel").trim() || defaultCurrencyLabel,
    )
    .catch(() => currentCurrencyLabel)
    .then((label) => {
      currentCurrencyLabel = label;
      currencyLabelListeners.forEach((listener) => listener(label));
      return label;
    });

  return currencyLabelRequest;
}

export function refreshSiteCurrencyLabel() {
  currencyLabelRequest = null;
  return fetchSiteCurrencyLabel();
}

export function formatCurrency(
  value?: number | null,
  options: CurrencyFormatOptions = {},
) {
  if (value === null || value === undefined) return "-";

  const formatted = new Intl.NumberFormat("fa-IR").format(value);
  if (options.showCurrency === false) return formatted;

  const currencyLabel = options.currencyLabel ?? currentCurrencyLabel;
  return currencyLabel ? `${formatted} ${currencyLabel}` : formatted;
}

export function useSiteCurrencyLabel(snapshot?: string | null) {
  const [currencyLabel, setCurrencyLabel] = useState(defaultCurrencyLabel);

  useEffect(() => {
    let active = true;
    currencyLabelListeners.add(setCurrencyLabel);
    setCurrencyLabel(currentCurrencyLabel);
    void fetchSiteCurrencyLabel().then((label) => {
      if (active) setCurrencyLabel(label);
    });

    return () => {
      active = false;
      currencyLabelListeners.delete(setCurrencyLabel);
    };
  }, []);

  return snapshot?.trim() || currencyLabel;
}
