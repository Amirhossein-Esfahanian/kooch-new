"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochUserProfileDialog } from "@/components/KoochUserProfileDialog";
import type { PropertyPermissionMatrix } from "@/components/auth/AuthSessionProvider";
import { useOwnerProperty } from "@/components/owner/OwnerPropertyProvider";
import type { PermissionGroup } from "@/lib/owner-api";
import { canViewOwnerMenuItem } from "@/lib/property-menu-permissions";
import { KoochIcon } from "../KoochIcon";

type DashboardMenuItem = {
  href: string;
  icon: string;
  label: string;
  exact?: boolean;
  platformPermission?: string;
};

type OwnerDashboardMenuItem = DashboardMenuItem & {
  permission: PermissionGroup;
};
const menuIcons = {
  settings: "/svgs/cog-l.svg",
  notification: "/svgs/bell-l.svg",
  logout: "/svgs/left-from-bracket-l.svg",
  account: "/svgs/user-circle-l.svg",
  menu: "/svgs/sidebar-flip-l.svg",
  close: "/svgs/x-l.svg",
  home: "/svgs/house-l.svg",
  messages: "/svgs/message-l.svg",
  dark: "/svgs/moon-cloud-l.svg",
  light: "/svgs/sun-alt-l.svg",
  search: "/svgs/search-l.svg",
} as const;

type MenuIconName = keyof typeof menuIcons;
const adminMenuItems: DashboardMenuItem[] = [
  {
    label: "Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯",
    icon: "/svgs/tachometer-alt.svg",
    href: "/admin",
    exact: true,
  },
  {
    label: "Ù…Ø¯ÛŒØ±ÛŒØª Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡â€ŒÙ‡Ø§",
    icon: "/svgs/hotel.svg",
    href: "/admin/properties",
  },
  { label: "Ù…Ø¯ÛŒØ±ÛŒØª Ú©Ø§Ø±Ø¨Ø±Ø§Ù†", icon: "/svgs/users.svg", href: "/admin/users" },
  { label: "Ù…Ø¯ÛŒØ±ÛŒØª Ù…Ù‡Ù…Ø§Ù†â€ŒÙ‡Ø§", icon: "/svgs/users.svg", href: "/admin/guests" },
  {
    label: "Ù…Ø¯ÛŒØ±ÛŒØª Ø§Ù…Ú©Ø§Ù†Ø§Øª",
    icon: "/svgs/folder-gear.svg",
    href: "/admin/amenities",
    platformPermission: "ManageAmenities",
  },
  {
    label: "ØªÙ†Ø¸ÛŒÙ…Ø§Øª Ø³Ø§ÛŒØª",
    icon: "/svgs/gear-complex-code.svg",
    href: "/admin/site-settings",
  },
  {
    label: "ØªÙ†Ø¸ÛŒÙ…Ø§Øª Ø±Ø²Ø±Ùˆ",
    icon: "/svgs/square-sliders.svg",
    href: "/admin/reservation-settings",
  },
  {
    label: "Ù…Ø¯ÛŒØ±ÛŒØª Ø±Ø²Ø±ÙˆÙ‡Ø§",
    icon: "/svgs/address-card.svg",
    href: "/admin/reservations",
  },
  { label: "Ù¾Ø±ÙˆÙ…ÙˆØ´Ù†â€ŒÙ‡Ø§", icon: "/svgs/tags.svg", href: "/admin/promotions" },
  { label: "Ú¯Ø²Ø§Ø±Ø´â€ŒÙ‡Ø§", icon: "/svgs/list.svg", href: "/admin/reports" },
  { label: "ØªÙ†Ø¸ÛŒÙ…Ø§Øª", icon: "/svgs/cogs.svg", href: "/admin/settings" },
];

function canViewAdminMenuItem(
  item: DashboardMenuItem,
  platformPermissions: string[],
) {
  return (
    !item.platformPermission || platformPermissions.includes(item.platformPermission)
  );
}
function MenuIcon({ icon }: { icon: string }) {
  const isSvgPath = icon.startsWith("/");

  if (!isSvgPath) {
    return <span>{icon}</span>;
  }

  return (
    <span
      aria-hidden="true"
      className="inline-block h-6 w-6 bg-current"
      style={{
        WebkitMask: `url(${icon}) center / contain no-repeat`,
        mask: `url(${icon}) center / contain no-repeat`,
      }}
    />
  );
}

function getOwnerMenuItems(
  propertyId: string | undefined,
  permissions: PropertyPermissionMatrix | null | undefined,
): DashboardMenuItem[] {
  const fallbackHref = "/owner/select-property";
  const base = propertyId ? `/owner/properties/${propertyId}` : fallbackHref;

  const items: OwnerDashboardMenuItem[] = [
    {
      label: "Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯",
      icon: "/svgs/tachometer-alt.svg",
      href: propertyId ? `${base}/dashboard` : fallbackHref,
      permission: "Dashboard",
    },
    {
      label: "Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ù…Ù†",
      icon: "/svgs/hotel.svg",
      href: propertyId ? base : "/owner/properties",
      exact: true,
      permission: "Properties",
    },
    {
      label: "Ø§ØªØ§Ù‚â€ŒÙ‡Ø§",
      icon: "/svgs/bed-alt.svg",
      href: propertyId ? `${base}/rooms` : fallbackHref,
      permission: "Rooms",
    },
    {
      label: "Ø¸Ø±ÙÛŒØª Ø§ØªØ§Ù‚â€ŒÙ‡Ø§",
      icon: "/svgs/table.svg",
      href: propertyId ? `${base}/inventory` : fallbackHref,
      permission: "Inventory",
    },
    {
      label: "Ù‚ÛŒÙ…Øªâ€ŒÚ¯Ø°Ø§Ø±ÛŒ Ø§ØªØ§Ù‚â€ŒÙ‡Ø§",
      icon: "/svgs/money-bill.svg",
      href: propertyId ? `${base}/pricing` : fallbackHref,
      permission: "Pricing",
    },
    {
      label: "Ù¾Ø±ÙˆÙ…ÙˆØ´Ù†â€ŒÙ‡Ø§",
      icon: "/svgs/tags.svg",
      href: propertyId ? `${base}/promotions` : fallbackHref,
      permission: "Pricing",
    },
    {
      label: "Ø±Ø²Ø±ÙˆÙ‡Ø§",
      icon: "/svgs/address-card.svg",
      href: propertyId ? `${base}/reservations` : fallbackHref,
      permission: "Bookings",
    },
    {
      label: "Ù†Ø¸Ø±Ø§Øª",
      icon: "/svgs/comment.svg",
      href: propertyId ? `${base}/reviews` : fallbackHref,
      permission: "Reviews",
    },
    {
      label: "Ú©Ø§Ø±Ø¨Ø±Ø§Ù†",
      icon: "/svgs/users.svg",
      href: propertyId ? `${base}/users` : fallbackHref,
      permission: "Users",
    },
    {
      label: "Ø³ÙˆØ§Ø¨Ù‚ Ø¹Ù…Ù„ÛŒØ§Øª",
      icon: "/svgs/list.svg",
      href: propertyId ? `${base}/change-logs` : fallbackHref,
      permission: "Reports",
    },
    {
      label: "ØªÙ†Ø¸ÛŒÙ…Ø§Øª",
      icon: "/svgs/cog.svg",
      href: propertyId ? `${base}/settings` : fallbackHref,
      permission: "Settings",
    },
  ];

  return items.filter((item) =>
    canViewOwnerMenuItem(permissions, item.permission),
  );
}

function DashboardAuthorizationLoading() {
  return (
    <div
      className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground"
      role="status"
    >
      Ø¯Ø± Ø­Ø§Ù„ Ø¨Ø±Ø±Ø³ÛŒ Ø¯Ø³ØªØ±Ø³ÛŒ...
    </div>
  );
}

const stats = [
  {
    title: "Ø±Ø²Ø±ÙˆÙ‡Ø§ÛŒ Ø§Ù…Ø±ÙˆØ²",
    value: "Û²Û´",
    detail: "Û¶ Ø±Ø²Ø±Ùˆ Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ ØªØ§ÛŒÛŒØ¯",
    icon: "â—·",
    tone: "primary",
  },
  {
    title: "Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡â€ŒÙ‡Ø§ÛŒ ÙØ¹Ø§Ù„",
    value: "Û±Û³Û¸",
    detail: "Û±Û² Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø± Ø¨Ø§Ø²Ø¨ÛŒÙ†ÛŒ",
    icon: "âŒ‚",
    tone: "success",
  },
  {
    title: "Ø¯Ø±Ø¢Ù…Ø¯ Ø§Ù…Ø±ÙˆØ²",
    value: "Û±Û¸Ù«Û¶ Ù…ÛŒÙ„ÛŒÙˆÙ†",
    detail: "Û±Û´Ùª Ø±Ø´Ø¯ Ù†Ø³Ø¨Øª Ø¨Ù‡ Ø¯ÛŒØ±ÙˆØ²",
    icon: "ï·¼",
    tone: "warning",
  },
  {
    title: "Ù¾Ø±ÙˆÙ…ÙˆØ´Ù†â€ŒÙ‡Ø§ÛŒ ÙØ¹Ø§Ù„",
    value: "Û±Û·",
    detail: "Ûµ Ù¾ÛŒØ´Ù†Ù‡Ø§Ø¯ Ù…Ø¯ÛŒØ±ÛŒØªÛŒ Ù…Ù†ØªØ´Ø± Ø´Ø¯Ù‡",
    icon: "%",
    tone: "primary",
  },
  {
    title: "Ù†Ø¸Ø±Ø§Øª Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø±",
    value: "Û¹",
    detail: "Û³ Ù†Ø¸Ø± Ø¨Ø§ Ø§Ù…ØªÛŒØ§Ø² Ù¾Ø§ÛŒÛŒÙ†",
    icon: "â˜†",
    tone: "danger",
  },
  {
    title: "Ø¸Ø±ÙÛŒØªâ€ŒÙ‡Ø§ÛŒ Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ Ø¨Ø±Ø±Ø³ÛŒ",
    value: "Û³Û±",
    detail: "Û· Ø±ÙˆØ² Ù¾Ø±ØªØ±Ø§ÙÛŒÚ© Ø¯Ø± Ù‡ÙØªÙ‡ Ø¢ÛŒÙ†Ø¯Ù‡",
    icon: "â‡…",
    tone: "warning",
  },
];

const recentReservations = [
  {
    guest: "Ø³Ø§Ø±Ø§ Ù†Ø§Ø¯Ø±ÛŒ",
    property: "Ø®Ø§Ù†Ù‡ Ø­ÛŒØ§Ø·â€ŒØ¯Ø§Ø± Ú©Ø§Ø´Ø§Ù†",
    date: "Ø§Ù…Ø±ÙˆØ²ØŒ Û±Û´:Û³Û°",
    amount: "Û³Ù«Û² Ù…ÛŒÙ„ÛŒÙˆÙ†",
    status: "Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø± ØªØ§ÛŒÛŒØ¯",
  },
  {
    guest: "Ù…Ø­Ù…Ø¯ Ø±Ø³ØªÙ…ÛŒ",
    property: "Ø¨ÙˆØªÛŒÚ© Ù‡ØªÙ„ Ø¨Ø§Øº ÙÛŒÙ†",
    date: "Ø§Ù…Ø±ÙˆØ²ØŒ Û±Û³:Û±Û°",
    amount: "ÛµÙ«Û¸ Ù…ÛŒÙ„ÛŒÙˆÙ†",
    status: "ØªØ§ÛŒÛŒØ¯ Ø´Ø¯Ù‡",
  },
  {
    guest: "Ù†ÛŒÙ„ÙˆÙØ± Ù‚Ø§Ø³Ù…ÛŒ",
    property: "Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ù…Ø³ÛŒØ± Ú©ÙˆÛŒØ±",
    date: "Ø¯ÛŒØ±ÙˆØ²ØŒ Û²Û±:Û´Ûµ",
    amount: "Û²Ù«Û´ Ù…ÛŒÙ„ÛŒÙˆÙ†",
    status: "Ù¾Ø±Ø¯Ø§Ø®Øª Ø´Ø¯Ù‡",
  },
  {
    guest: "Ø¢Ø±Ù…Ø§Ù† Ø´ÙÛŒØ¹ÛŒ",
    property: "Ø®Ø§Ù†Ù‡ Ø³Ù†ØªÛŒ Ù†Ù‚Ø±Ù‡",
    date: "Ø¯ÛŒØ±ÙˆØ²ØŒ Û±Û¸:Û²Û°",
    amount: "Û´Ù«Û± Ù…ÛŒÙ„ÛŒÙˆÙ†",
    status: "Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ ØªÙ…Ø§Ø³",
  },
];

const activities = [
  "Ù‚ÛŒÙ…Øª Ø§ØªØ§Ù‚ Ø¯Ø§Ø¨Ù„ Ø¨Ø±Ø§ÛŒ Ø¢Ø®Ø± Ù‡ÙØªÙ‡ Ø¨Ù‡â€ŒØ±ÙˆØ²Ø±Ø³Ø§Ù†ÛŒ Ø´Ø¯.",
  "Ù¾Ø±ÙˆÙ…ÙˆØ´Ù† Â«Û³ Ø´Ø¨ Ø§Ù‚Ø§Ù…ØªØŒ Ú¯Ø´Øª Ø±Ø§ÛŒÚ¯Ø§Ù†Â» ÙØ¹Ø§Ù„ Ø´Ø¯.",
  "ØªØµØ§ÙˆÛŒØ± Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ø®Ø§Ù†Ù‡ Ø¨Ø§Øº ØªÙˆØ³Ø· Ù…Ø§Ù„Ú© ØªØºÛŒÛŒØ± Ú©Ø±Ø¯.",
  "Ø¸Ø±ÙÛŒØª Ø§ØªØ§Ù‚ Ø´Ø§Ù‡â€ŒÙ†Ø´ÛŒÙ† Ø¯Ø± ØªØ§Ø±ÛŒØ® Û±Û² ØªÛŒØ± ØªÚ©Ù…ÛŒÙ„ Ø´Ø¯.",
  "Ú©Ø§Ø±Ø¨Ø± Ø¬Ø¯ÛŒØ¯ Ø¨Ù‡ Ù¾Ù†Ù„ Ù…Ø§Ù„Ú© Ø§Ø¶Ø§ÙÙ‡ Ø´Ø¯.",
];

const messages = [
  { name: "Ù…Ø§Ù„Ú© Ø®Ø§Ù†Ù‡ Ú©Ø§Ø¬", text: "Ø¯Ø±Ø®ÙˆØ§Ø³Øª Ø¨Ø±Ø±Ø³ÛŒ ØªØµØ§ÙˆÛŒØ± Ø¬Ø¯ÛŒØ¯", unread: true },
  {
    name: "Ù¾Ø´ØªÛŒØ¨Ø§Ù†ÛŒ Ú©ÙˆÚ†",
    text: "Û³ Ø±Ø²Ø±Ùˆ Ø§Ù…Ø±ÙˆØ² Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ Ù¾ÛŒÚ¯ÛŒØ±ÛŒ Ø§Ø³Øª",
    unread: true,
  },
  {
    name: "Ø³ÛŒØ³ØªÙ… Ù‚ÛŒÙ…Øªâ€ŒÚ¯Ø°Ø§Ø±ÛŒ",
    text: "Ù‡Ø´Ø¯Ø§Ø± Ø§Ø®ØªÙ„Ø§Ù Ø¸Ø±ÙÛŒØª Ùˆ Ù‚ÛŒÙ…Øª",
    unread: false,
  },
];

const notifications = [
  {
    title: "Ø±Ø²Ø±Ùˆ Ø¬Ø¯ÛŒØ¯ Ø«Ø¨Øª Ø´Ø¯",
    text: "Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ø®Ø§Ù†Ù‡ Ø­ÛŒØ§Ø·â€ŒØ¯Ø§Ø± Ú©Ø§Ø´Ø§Ù† ÛŒÚ© Ø±Ø²Ø±Ùˆ ØªØ§Ø²Ù‡ Ø¯Ø§Ø±Ø¯.",
    unread: true,
  },
  {
    title: "Ù†ÛŒØ§Ø² Ø¨Ù‡ ØªØ§ÛŒÛŒØ¯ ØªØµÙˆÛŒØ±",
    text: "Û´ ØªØµÙˆÛŒØ± Ø¬Ø¯ÛŒØ¯ Ø¯Ø± ØµÙ Ø¨Ø±Ø±Ø³ÛŒ Ù‚Ø±Ø§Ø± Ú¯Ø±ÙØªÙ‡ Ø§Ø³Øª.",
    unread: true,
  },
  {
    title: "Ù‡Ø´Ø¯Ø§Ø± Ø¸Ø±ÙÛŒØª",
    text: "Ø¸Ø±ÙÛŒØª Ø¨Ø±Ø®ÛŒ Ø§ØªØ§Ù‚â€ŒÙ‡Ø§ Ø¨Ø±Ø§ÛŒ Ø¢Ø®Ø± Ù‡ÙØªÙ‡ Ú©Ø§Ù…Ù„ Ø´Ø¯Ù‡ Ø§Ø³Øª.",
    unread: false,
  },
];

const drawerEvents = [
  { time: "Û±Û°:Û³Û°", title: "Ø¨Ø±Ø±Ø³ÛŒ Ø±Ø²Ø±ÙˆÙ‡Ø§ÛŒ Ø§Ù…Ø±ÙˆØ²" },
  { time: "Û±Û²:Û°Û°", title: "ØªÙ…Ø§Ø³ Ø¨Ø§ Ù…Ø§Ù„Ú© Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ø¨Ø§Øº ÙÛŒÙ†" },
  { time: "Û±Û¶:Û´Ûµ", title: "Ø¨Ø§Ø²Ø¨ÛŒÙ†ÛŒ Ù¾Ø±ÙˆÙ…ÙˆØ´Ù†â€ŒÙ‡Ø§ÛŒ Ù…Ù†ØªØ´Ø± Ø´Ø¯Ù‡" },
];

const drawerNotes = [
  "ØªØµØ§ÙˆÛŒØ± Û´ Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ Ù†ÛŒØ§Ø² Ø¨Ù‡ ØªØ§ÛŒÛŒØ¯ Ø¯Ø§Ø±Ø¯.",
  "Ù‚ÛŒÙ…Øªâ€ŒÚ¯Ø°Ø§Ø±ÛŒ Ø¢Ø®Ø± Ù‡ÙØªÙ‡ Ø¨Ø±Ø§ÛŒ Û² Ø§ØªØ§Ù‚ Ø®Ø§Ù„ÛŒ Ø§Ø³Øª.",
];

const quickSettings = [
  "Ù†Ù…Ø§ÛŒØ´ Ø§Ø¹Ù„Ø§Ù†â€ŒÙ‡Ø§ÛŒ ÙÙˆØ±ÛŒ",
  "Ø­Ø§Ù„Øª ÙØ´Ø±Ø¯Ù‡ Ù¾Ù†Ù„",
  "ÛŒØ§Ø¯Ø¢ÙˆØ±ÛŒ Ø±Ø²Ø±ÙˆÙ‡Ø§ÛŒ Ø¬Ø¯ÛŒØ¯",
];

const chartBars = [34, 58, 44, 72, 63, 86, 51, 79, 92, 66, 74, 88];

export function AdminLayout({
  children,
}: {
  children: ReactNode | ((darkMode: boolean) => ReactNode);
}) {
  const router = useRouter();
  const refreshAttemptedRef = useRef(false);
  const {
    authenticated,
    defaultPropertyId,
    loading,
    platformPermissions,
    refreshSession,
    workspaces,
  } = useAuthSession();
  const { switchProperty: switchOwnerProperty } = useOwnerProperty();
  const hasAdminWorkspace = workspaces.includes("admin");
  const hasOwnerWorkspace = workspaces.includes("owner");
  const visibleAdminMenuItems = adminMenuItems.filter((item) =>
    canViewAdminMenuItem(item, platformPermissions),
  );

  useEffect(() => {
    if (loading) return;

    if (!authenticated) {
      if (!refreshAttemptedRef.current) {
        refreshAttemptedRef.current = true;
        void refreshSession({ redirectOnUnauthorized: true }).catch(() => {
          router.replace("/");
        });
      }
      return;
    }

    refreshAttemptedRef.current = false;
    if (hasAdminWorkspace) return;

    if (hasOwnerWorkspace) {
      if (defaultPropertyId) {
        switchOwnerProperty(defaultPropertyId, { replace: true });
        return;
      }

      router.replace("/owner/select-property");
      return;
    }

    router.replace("/");
  }, [
    authenticated,
    defaultPropertyId,
    hasAdminWorkspace,
    hasOwnerWorkspace,
    loading,
    platformPermissions,
    refreshSession,
    router,
    switchOwnerProperty,
  ]);

  if (loading || !authenticated || !hasAdminWorkspace) {
    return <DashboardAuthorizationLoading />;
  }

  return <DashboardShell menuItems={visibleAdminMenuItems}>{children}</DashboardShell>;
}

export function OwnerLayout({
  children,
}: {
  children: ReactNode | ((darkMode: boolean) => ReactNode);
}) {
  const router = useRouter();
  const refreshAttemptedRef = useRef(false);
  const {
    authenticated,
    loading,
    refreshSession,
    workspaces,
  } = useAuthSession();
  const {
    activeMemberships,
    effectivePermissions,
    propertyId,
    propertyName,
    routePropertyIsValid,
    switchProperty: switchOwnerProperty,
  } = useOwnerProperty();
  const hasOwnerWorkspace = workspaces.includes("owner");

  useEffect(() => {
    if (loading) return;

    if (!authenticated) {
      if (!refreshAttemptedRef.current) {
        refreshAttemptedRef.current = true;
        void refreshSession({ redirectOnUnauthorized: true }).catch(() => {
          router.replace("/");
        });
      }
      return;
    }

    refreshAttemptedRef.current = false;
    if (!hasOwnerWorkspace) {
      router.replace(workspaces.includes("admin") ? "/admin" : "/");
      return;
    }
  }, [
    authenticated,
    hasOwnerWorkspace,
    loading,
    refreshSession,
    router,
    workspaces,
  ]);

  function handlePropertySwitch(nextPropertyId: string) {
    if (!nextPropertyId) {
      router.push("/owner/select-property");
      return;
    }

    switchOwnerProperty(Number(nextPropertyId));
  }

  if (
    loading ||
    !authenticated ||
    !hasOwnerWorkspace ||
    activeMemberships.length === 0 ||
    !routePropertyIsValid
  ) {
    return <DashboardAuthorizationLoading />;
  }

  return (
    <DashboardShell
      currentWorkspaceId={propertyId?.toString()}
      menuItems={getOwnerMenuItems(
        propertyId?.toString(),
        effectivePermissions,
      )}
      onWorkspaceChange={handlePropertySwitch}
      workspaceLabel={propertyName ?? "Ø§Ù†ØªØ®Ø§Ø¨ Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡"}
      workspaceOptions={activeMemberships.map((membership) => ({
        id: membership.propertyId.toString(),
        name: membership.propertyName,
      }))}
    >
      {children}
    </DashboardShell>
  );
}

export function DashboardHomeContent({ darkMode }: { darkMode: boolean }) {
  return (
    <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-6">
      <div className="grid min-w-0 gap-5">
        <HeroHeader />
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map((stat) => (
            <DashboardStatCard key={stat.title} {...stat} />
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <DashboardSectionCard
            title="Ù†Ù…ÙˆØ¯Ø§Ø± Ø±Ø²Ø±ÙˆÙ‡Ø§"
            subtitle="placeholder Ø³Ø§Ø¯Ù‡ Ø¨Ø¯ÙˆÙ† Ú©ØªØ§Ø¨Ø®Ø§Ù†Ù‡ Ù†Ù…ÙˆØ¯Ø§Ø±"
          >
            <SimpleChart darkMode={darkMode} />
          </DashboardSectionCard>
          <DashboardSectionCard
            title="ÙˆØ¶Ø¹ÛŒØª Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡â€ŒÙ‡Ø§"
            subtitle="Ù†Ù…Ø§ÛŒ Ø®Ù„Ø§ØµÙ‡ mock data"
          >
            <PropertyStatus darkMode={darkMode} />
          </DashboardSectionCard>
        </section>

        <DashboardSectionCard
          title="Ø±Ø²Ø±ÙˆÙ‡Ø§ÛŒ Ø§Ø®ÛŒØ±"
          subtitle="Ø¢Ø®Ø±ÛŒÙ† Ø¯Ø±Ø®ÙˆØ§Ø³Øªâ€ŒÙ‡Ø§ÛŒ Ø«Ø¨Øªâ€ŒØ´Ø¯Ù‡ Ø¯Ø± Ú©ÙˆÚ†"
        >
          <RecentReservations />
        </DashboardSectionCard>
      </div>

      <aside className="grid h-fit gap-5 lg:sticky lg:top-6">
        <DashboardSectionCard
          title="ÙØ¹Ø§Ù„ÛŒØªâ€ŒÙ‡Ø§ÛŒ Ø§Ø®ÛŒØ±"
          subtitle="Ø±ÙˆÛŒØ¯Ø§Ø¯Ù‡Ø§ÛŒ Ù…Ù‡Ù… Ù¾Ù†Ù„"
        >
          <ActivityList />
        </DashboardSectionCard>
        <DashboardSectionCard
          title="Ù¾ÛŒØ§Ù…â€ŒÙ‡Ø§ / Ø§Ø¹Ù„Ø§Ù†â€ŒÙ‡Ø§"
          subtitle="placeholder Ø±ÛŒÙ„ Ú©Ù†Ø§Ø±ÛŒ"
        >
          <MessageRail />
        </DashboardSectionCard>
      </aside>
    </main>
  );
}

function DashboardShell({
  children,
  currentWorkspaceId,
  menuItems,
  onWorkspaceChange,
  workspaceLabel = "Ù¾Ù†Ù„ Ù…Ø¯ÛŒØ±ÛŒØª",
  workspaceOptions = [],
}: {
  children: ReactNode | ((darkMode: boolean) => ReactNode);
  currentWorkspaceId?: string;
  menuItems: DashboardMenuItem[];
  onWorkspaceChange?: (workspaceId: string) => void;
  workspaceLabel?: string;
  workspaceOptions?: { id: string; name: string }[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [drawerType, setDrawerType] = useState<
    "messages" | "notifications" | null
  >(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => {
    if (!drawerType && !profileMenuOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerType(null);
        setProfileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [drawerType, profileMenuOpen]);

  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden  ${darkMode ? "dark" : ""} ${
        darkMode ? "bg-[#0b0f17] text-slate-100" : "bg-slate-100 text-slate-950"
      }`}
      dir="rtl"
    >
      {mobileSidebarOpen && (
        <button
          className="fixed inset-0 z-40 bg-slate-950/45 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          type="button"
          aria-label="Ø¨Ø³ØªÙ† Ù…Ù†Ùˆ"
        />
      )}
      <div className="flex h-full">
        <DashboardSidebar
          collapsed={collapsed}
          currentWorkspaceId={currentWorkspaceId}
          darkMode={darkMode}
          menuItems={menuItems}
          mobileOpen={mobileSidebarOpen}
          onCollapse={() => setCollapsed((value) => !value)}
          onMobileClose={() => setMobileSidebarOpen(false)}
          onWorkspaceChange={onWorkspaceChange}
          workspaceLabel={workspaceLabel}
          workspaceOptions={workspaceOptions}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <DashboardHeader
            activeDrawer={drawerType}
            darkMode={darkMode}
            profileMenuOpen={profileMenuOpen}
            onDrawerToggle={(type) => {
              setProfileMenuOpen(false);
              setDrawerType((current) => (current === type ? null : type));
            }}
            onProfileMenuClose={() => setProfileMenuOpen(false)}
            onProfileMenuToggle={() => {
              setDrawerType(null);
              setProfileMenuOpen((value) => !value);
            }}
            onThemeToggle={() => setDarkMode((value) => !value)}
            onSidebarToggle={() => setMobileSidebarOpen(true)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {typeof children === "function" ? children(darkMode) : children}
          </div>
        </div>
      </div>
      <DashboardSideDrawer
        darkMode={darkMode}
        type={drawerType}
        onClose={() => setDrawerType(null)}
      />
    </div>
  );
}

function DashboardSidebar({
  collapsed,
  currentWorkspaceId,
  darkMode,
  menuItems,
  mobileOpen,
  onCollapse,
  onMobileClose,
  onWorkspaceChange,
  workspaceLabel,
  workspaceOptions,
}: {
  collapsed: boolean;
  currentWorkspaceId?: string;
  darkMode: boolean;
  menuItems: DashboardMenuItem[];
  mobileOpen: boolean;
  onCollapse: () => void;
  onMobileClose: () => void;
  onWorkspaceChange?: (workspaceId: string) => void;
  workspaceLabel: string;
  workspaceOptions: { id: string; name: string }[];
}) {
  const pathname = usePathname();

  return (
    <aside
      className={`fixed inset-y-0 right-0 z-50 h-full shrink-0 border-l transition-all duration-300 md:static md:z-auto md:block ${
        mobileOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"
      } ${collapsed ? "md:w-24" : "md:w-72"} w-72 ${
        darkMode
          ? "border-white/10 bg-[#111720]"
          : "border-slate-200 bg-slate-200/95"
      }`}
    >
      <div className="flex h-full flex-col px-2 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--theme-primary)] text-lg font-black text-white shadow-lg shadow-blue-600/20">
              Ú©ÙˆÚ†
            </div>
            {!collapsed && (
              <div className="min-w-0 [&>p:last-child]:hidden">
                <p className="text-sm font-black">Kooch</p>
                <p className={`truncate ${mutedText(darkMode)}`}>
                  {workspaceLabel}
                </p>
                <p className={mutedText(darkMode)}>Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯ Ù†Ù…ÙˆÙ†Ù‡</p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              className={`hidden h-9 w-9 place-items-center rounded-lg border text-sm transition hover:border-[var(--theme-primary)] md:grid ${
                darkMode
                  ? "border-white/10 bg-white/5"
                  : "border-slate-300 bg-white"
              }`}
              onClick={onCollapse}
              type="button"
              aria-label="Ø¬Ù…Ø¹ Ú©Ø±Ø¯Ù† Ù…Ù†Ùˆ"
            >
              <MenuIcon icon={menuIcons.menu} />
            </button>
            <button
              className={`grid h-9 w-9 place-items-center rounded-lg border text-sm md:hidden ${darkMode ? "border-white/10 bg-white/5" : "border-slate-300 bg-white"}`}
              onClick={onMobileClose}
              type="button"
              aria-label="Ø¨Ø³ØªÙ† Ù…Ù†Ùˆ"
            >
              <MenuIcon icon={menuIcons.close} />
            </button>
          </div>
        </div>

        {!collapsed && workspaceOptions.length > 1 && onWorkspaceChange && (
          <select
            className={`mt-4 h-10 w-full rounded-lg border px-3 text-sm font-bold outline-none transition focus:border-[var(--theme-primary)] ${
              darkMode
                ? "border-white/10 bg-white/5 text-slate-100"
                : "border-slate-300 bg-white text-slate-900"
            }`}
            onChange={(event) => onWorkspaceChange(event.target.value)}
            value={currentWorkspaceId ?? ""}
          >
            <option value="">Ø§Ù†ØªØ®Ø§Ø¨ Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡</option>
            {workspaceOptions.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        )}

        <nav className="mt-6 grid gap-1">
          {menuItems.map((item) => {
            const hrefPath = item.href.split("#")[0];
            const isHashLink = item.href.includes("#");
            const active = isHashLink
              ? false
              : item.exact
                ? pathname === hrefPath
                : pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);

            return (
              <Link
                className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-black transition ${
                  active
                    ? "bg-[var(--theme-primary)] text-white shadow-lg shadow-blue-600/20"
                    : darkMode
                      ? "text-slate-300 hover:bg-white/10 hover:text-white"
                      : "text-slate-700 hover:bg-white hover:text-[var(--theme-primary-text)]"
                } ${collapsed ? "md:justify-center" : "justify-start"}`}
                href={item.href}
                key={item.label}
              >
                {/* <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs ${
                    active
                      ? "bg-white/20"
                      : darkMode
                        ? "bg-white/5"
                        : "bg-white/70"
                  }`}
                ></span> */}
                <MenuIcon icon={item.icon} />
                <span className={collapsed ? "md:hidden" : ""}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div
          className={`mt-auto hidden rounded-lg border p-4 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-white"}`}
        >
          {!collapsed ? (
            <>
              <p className="text-sm font-black">Ù†Ù…ÙˆÙ†Ù‡ Ù‚Ø§Ø¨Ù„ Ø¨Ø§Ø²Ø§Ø³ØªÙØ§Ø¯Ù‡</p>
              <p className={`mt-2 text-xs leading-6 ${mutedText(darkMode)}`}>
                Ø§ÛŒÙ† Ø´ÙÙ„ Ø¨Ø¹Ø¯Ø§Ù‹ Ù…ÛŒâ€ŒØªÙˆØ§Ù†Ø¯ Ù¾Ø§ÛŒÙ‡ AdminLayout Ùˆ OwnerLayout Ø´ÙˆØ¯.
              </p>
            </>
          ) : (
            <p className="text-center text-lg">âœ¦</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function DashboardHeader({
  activeDrawer,
  darkMode,
  onDrawerToggle,
  onProfileMenuClose,
  onProfileMenuToggle,
  onThemeToggle,
  onSidebarToggle,
  profileMenuOpen,
}: {
  activeDrawer: "messages" | "notifications" | null;
  darkMode: boolean;
  onDrawerToggle: (type: "messages" | "notifications") => void;
  onProfileMenuClose: () => void;
  onProfileMenuToggle: () => void;
  onThemeToggle: () => void;
  onSidebarToggle: () => void;
  profileMenuOpen: boolean;
}) {
  const router = useRouter();
  const { clearSession, user } = useAuthSession();
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const userName = user?.fullName || user?.email || "Ú©Ø§Ø±Ø¨Ø± Ú©ÙˆÚ†";

  function handleProfileMenuAction(item: string) {
    onProfileMenuClose();

    if (item === "Ø®Ø±ÙˆØ¬ Ø§Ø² Ø­Ø³Ø§Ø¨") {
      clearSession();
      router.push("/login");
      return;
    }

    setProfileDialogOpen(true);
  }

  return (
    <>
      <header
        className={`border-b px-4 py-3 lg:px-6 ${darkMode ? "border-white/10 bg-[#0f141d]" : "border-slate-200 bg-white"}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            className={`grid h-10 w-10 place-items-center rounded-xl border md:hidden ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
            onClick={onSidebarToggle}
            type="button"
            aria-label="Ù†Ù…Ø§ÛŒØ´ Ù…Ù†Ùˆ"
          >
            â˜°
          </button>
          <div
            className={`hidden text-xs font-bold sm:block ${mutedText(darkMode)}`}
          >
            Ø®Ø§Ù†Ù‡ / Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯Ù‡Ø§ / Ù†Ù…ÙˆÙ†Ù‡ Ù¾Ù†Ù„ Ú©ÙˆÚ†
          </div>
          <div
            className={`mr-auto flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border px-3 py-2 md:max-w-md ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
          >
            <span className={mutedText(darkMode)}>âŒ•</span>
            <input
              className="w-full border-0 bg-transparent p-0 text-sm outline-none"
              placeholder="Ø¬Ø³ØªØ¬Ùˆ Ø¯Ø± Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡ØŒ Ø±Ø²Ø±ÙˆØŒ Ú©Ø§Ø±Ø¨Ø±..."
              type="search"
            />
          </div>
          <HeaderIcon
            active={activeDrawer === "messages"}
            darkMode={darkMode}
            label="Ù¾ÛŒØ§Ù…â€ŒÙ‡Ø§"
            onClick={() => onDrawerToggle("messages")}
          >
            <MenuIcon icon={menuIcons.messages} />
          </HeaderIcon>
          <HeaderIcon
            active={activeDrawer === "notifications"}
            darkMode={darkMode}
            label="Ø§Ø¹Ù„Ø§Ù†â€ŒÙ‡Ø§"
            onClick={() => onDrawerToggle("notifications")}
          >
            <MenuIcon icon={menuIcons.notification} />

            {/* come back here */}
          </HeaderIcon>
          <button
            className={`grid h-10 w-10 place-items-center rounded-xl border transition hover:border-[var(--theme-primary)] ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
            onClick={onThemeToggle}
            type="button"
            aria-label="ØªØºÛŒÛŒØ± Ø­Ø§Ù„Øª Ø±ÙˆØ´Ù† Ùˆ ØªÛŒØ±Ù‡"
          >
            {darkMode ? (
              <MenuIcon icon={menuIcons.light} />
            ) : (
              <MenuIcon icon={menuIcons.dark} />
            )}
          </button>
          <div className="relative">
            {profileMenuOpen && (
              <button
                className="fixed inset-0 z-[60] cursor-default"
                onClick={onProfileMenuClose}
                type="button"
                aria-label="Ø¨Ø³ØªÙ† Ù…Ù†ÙˆÛŒ Ù¾Ø±ÙˆÙØ§ÛŒÙ„"
              />
            )}
            <button
              className={`relative z-[80] flex items-center gap-2 rounded-xl border px-2 py-1.5 transition hover:border-[var(--theme-primary)] ${
                profileMenuOpen
                  ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)]"
                  : darkMode
                    ? "border-white/10 bg-white/5"
                    : "border-slate-200 bg-slate-50"
              }`}
              onClick={onProfileMenuToggle}
              type="button"
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--theme-primary)] text-xs font-black text-white">
                {userName.charAt(0)}
              </span>
              <span className="hidden text-sm font-bold lg:inline">
                {userName}
              </span>
              <span className={mutedText(darkMode)}>v</span>
            </button>
            {profileMenuOpen && (
              <div
                className={`absolute left-0 top-12 z-[90] w-52 overflow-hidden rounded-xl border p-1 text-sm font-bold shadow-2xl ${
                  darkMode
                    ? "border-white/10 bg-[#111720] text-slate-100"
                    : "border-slate-200 bg-white text-slate-800"
                }`}
                role="menu"
              >
                {["Ù…Ø´Ø§Ù‡Ø¯Ù‡ Ù¾Ø±ÙˆÙØ§ÛŒÙ„", "ØªÙ†Ø¸ÛŒÙ…Ø§Øª Ø­Ø³Ø§Ø¨", "Ø®Ø±ÙˆØ¬ Ø§Ø² Ø­Ø³Ø§Ø¨"].map(
                  (item) => (
                    <button
                      className={`block w-full rounded-lg px-3 py-2 text-right transition ${
                        darkMode ? "hover:bg-white/10" : "hover:bg-slate-100"
                      } ${item === "Ø®Ø±ÙˆØ¬ Ø§Ø² Ø­Ø³Ø§Ø¨" ? "text-[var(--theme-danger)]" : ""}`}
                      key={item}
                      onClick={() => handleProfileMenuAction(item)}
                      role="menuitem"
                      type="button"
                    >
                      {item}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <KoochUserProfileDialog
        onOpenChange={setProfileDialogOpen}
        open={profileDialogOpen}
      />
    </>
  );
}

function HeroHeader() {
  return (
    <KoochPageHeader
      actions={
        <>
          <span className="rounded-full bg-[var(--theme-primary-soft)] px-4 py-2 text-sm font-black text-[var(--theme-primary-text)]">
            Ø§Ù…Ø±ÙˆØ²: Û¶ ØªÛŒØ± Û±Û´Û°Ûµ
          </span>
          <span className="rounded-full bg-muted px-4 py-2 text-sm font-black text-muted-foreground">
            Mock Data
          </span>
        </>
      }
      description="ÛŒÚ© Ù†Ù…ÙˆÙ†Ù‡ Ø­Ø±ÙÙ‡â€ŒØ§ÛŒ Ùˆ Fuse-inspired Ø¨Ø±Ø§ÛŒ Ø§Ø±Ø²ÛŒØ§Ø¨ÛŒ Ø³Ø§Ø®ØªØ§Ø± Ù¾Ù†Ù„Ø› Ø¨Ø¯ÙˆÙ† Ø§ØªØµØ§Ù„ Ø¨Ù‡ Ø¨Ú©â€ŒØ§Ù†Ø¯ Ùˆ Ø¨Ø¯ÙˆÙ† ØªØºÛŒÛŒØ± Ø¯Ø± ØµÙØ­Ø§Øª ÙØ¹Ù„ÛŒ."
      eyebrow="Ù¾Ø±ÙˆØªÙˆØªØ§ÛŒÙ¾ Ø¨ØµØ±ÛŒ"
      title="Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯ Ù…Ø¯ÛŒØ±ÛŒØªÛŒ Ú©ÙˆÚ†"
    />
  );
}

function DashboardStatCard({
  title,
  value,
  detail,
  icon,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  icon: string;
  tone: string;
}) {
  const toneClass =
    tone === "success"
      ? "bg-[var(--theme-success-soft)] text-[var(--theme-success)]"
      : tone === "warning"
        ? "bg-[var(--theme-warning-soft)] text-[var(--theme-warning)]"
        : tone === "danger"
          ? "bg-[var(--theme-danger-soft)] text-[var(--theme-danger)]"
          : "bg-[var(--theme-primary-soft)] text-[var(--theme-primary-text)]";

  return (
    <KoochCard
      className="transition hover:-translate-y-1 hover:shadow-xl"
      variant="elevated"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-muted-foreground">{title}</p>
          <p className="mt-3 text-3xl font-black text-foreground">{value}</p>
        </div>
        <span
          className={`grid h-12 w-12 place-items-center rounded-xl text-lg ${toneClass}`}
        >
          {icon}
        </span>
      </div>
      <p className="mt-5 rounded-xl bg-muted px-3 py-2 text-xs font-bold text-muted-foreground">
        {detail}
      </p>
    </KoochCard>
  );
}

function DashboardSectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <KoochCard variant="elevated">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-foreground">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </KoochCard>
  );
}

function SimpleChart({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="h-72 rounded-lg bg-muted p-4">
      <div className="flex h-full items-end gap-2">
        {chartBars.map((height, index) => (
          <div className="flex flex-1 flex-col items-center gap-2" key={index}>
            <div
              className="w-full rounded-t-lg bg-gradient-to-t from-[var(--theme-primary)] to-[var(--theme-accent)] opacity-85 transition hover:opacity-100"
              style={{ height: `${height}%` }}
            />
            <span className={`text-[10px] font-bold ${mutedText(darkMode)}`}>
              {index + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PropertyStatus({ darkMode }: { darkMode: boolean }) {
  const rows = [
    ["ØªØ§ÛŒÛŒØ¯ Ø´Ø¯Ù‡", "Û¸Û¶Ùª"],
    ["Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø± Ø¨Ø§Ø²Ø¨ÛŒÙ†ÛŒ", "Û¹Ùª"],
    ["Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ Ø§ØµÙ„Ø§Ø­", "ÛµÙª"],
  ];

  return (
    <div className="grid gap-4">
      {rows.map(([label, value], index) => (
        <div key={label}>
          <div className="mb-2 flex items-center justify-between text-sm font-bold">
            <span>{label}</span>
            <span className={mutedText(darkMode)}>{value}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${index === 0 ? "bg-[var(--theme-success)]" : index === 1 ? "bg-[var(--theme-warning)]" : "bg-[var(--theme-danger)]"}`}
              style={{ width: value }}
            />
          </div>
        </div>
      ))}
      <div className="rounded-lg border border-dashed border-border bg-muted p-5 text-center">
        <p className="text-3xl font-black text-[var(--theme-primary-text)]">
          Û±Û´Û²
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ú©Ù„ Ø§Ù‚Ø§Ù…ØªÚ¯Ø§Ù‡â€ŒÙ‡Ø§ÛŒ Ø«Ø¨Øªâ€ŒØ´Ø¯Ù‡
        </p>
      </div>
    </div>
  );
}

function RecentReservations() {
  return (
    <div className="overflow-hidden rounded-lg">
      <div className="grid gap-3">
        {recentReservations.map((reservation) => (
          <KoochCard
            className="grid gap-3 transition hover:border-primary md:grid-cols-[1fr_1fr_120px_120px]"
            key={`${reservation.guest}-${reservation.date}`}
            padding="sm"
            variant="muted"
          >
            <div>
              <p className="font-black text-foreground">{reservation.guest}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {reservation.date}
              </p>
            </div>
            <p className="font-bold text-foreground">{reservation.property}</p>
            <p className="font-black text-[var(--theme-primary-text)]">
              {reservation.amount}
            </p>
            <span className="w-fit rounded-full bg-card px-3 py-1 text-xs font-black text-card-foreground">
              {reservation.status}
            </span>
          </KoochCard>
        ))}
      </div>
    </div>
  );
}

function ActivityList() {
  return (
    <div className="grid gap-3">
      {activities.map((activity, index) => (
        <div className="flex gap-3" key={activity}>
          <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--theme-primary-soft)] text-xs font-black text-[var(--theme-primary-text)]">
            {index + 1}
          </span>
          <p className="rounded-xl border border-border bg-muted p-3 text-sm leading-6 text-foreground">
            {activity}
          </p>
        </div>
      ))}
    </div>
  );
}

function MessageRail() {
  return (
    <div className="grid gap-3">
      {messages.map((message) => (
        <KoochCard key={message.name} padding="sm" variant="muted">
          <div className="flex items-center justify-between gap-3">
            <p className="font-black text-foreground">{message.name}</p>
            {message.unread && (
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--theme-primary)]" />
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {message.text}
          </p>
        </KoochCard>
      ))}
    </div>
  );
}

function DashboardSideDrawer({
  darkMode,
  onClose,
  type,
}: {
  darkMode: boolean;
  onClose: () => void;
  type: "messages" | "notifications" | null;
}) {
  const open = Boolean(type);
  const title = type === "messages" ? "Ù¾ÛŒØ§Ù…â€ŒÙ‡Ø§" : "Ø§Ø¹Ù„Ø§Ù†â€ŒÙ‡Ø§";

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[120] ${open ? "" : "invisible"}`}
      aria-hidden={!open}
    >
      <button
        className={`absolute inset-0 bg-slate-950/35 transition-opacity duration-300 ${open ? "pointer-events-auto opacity-100" : "opacity-0"}`}
        onClick={onClose}
        type="button"
        aria-label="Ø¨Ø³ØªÙ† Ù¾Ù†Ù„"
      />
      <aside
        className={`pointer-events-auto absolute inset-x-3 bottom-3 max-h-[88vh] overflow-hidden rounded-lg border shadow-2xl transition duration-300 sm:inset-x-auto sm:bottom-0 sm:left-0 sm:top-0 sm:h-full sm:max-h-none sm:w-[330px] sm:rounded-none sm:rounded-r-2xl ${
          open
            ? "translate-y-0 opacity-100 sm:translate-x-0"
            : "translate-y-8 opacity-0 sm:-translate-x-full sm:translate-y-0"
        } ${darkMode ? "border-white/10 bg-[#111720] text-slate-100" : "border-slate-200 bg-white text-slate-950"}`}
        dir="rtl"
      >
        <div className="flex h-full flex-col">
          <div
            className={`flex items-center justify-between border-b p-4 ${darkMode ? "border-white/10" : "border-slate-200"}`}
          >
            <div>
              <p className="text-xs font-bold text-[var(--theme-primary-text)]">
                Ù¾Ù†Ù„ Ø³Ø±ÛŒØ¹
              </p>
              <h2 className="mt-1 text-xl font-black">{title}</h2>
            </div>
            <button
              className={`grid h-9 w-9 place-items-center rounded-lg border text-sm transition hover:border-[var(--theme-primary)] ${
                darkMode
                  ? "border-white/10 bg-white/5"
                  : "border-slate-200 bg-slate-50"
              }`}
              onClick={onClose}
              type="button"
              aria-label="Ø¨Ø³ØªÙ†"
            >
              Ã—
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <section
              className={`rounded-lg border p-4 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
            >
              <p className={`text-xs font-bold ${mutedText(darkMode)}`}>
                Ø§Ù…Ø±ÙˆØ²
              </p>
              <p className="mt-1 text-2xl font-black">Û¶ ØªÛŒØ± Û±Û´Û°Ûµ</p>
              <p className={`mt-2 text-sm ${mutedText(darkMode)}`}>
                Û³ Ø±ÙˆÛŒØ¯Ø§Ø¯ Ùˆ Û² ÛŒØ§Ø¯Ø¯Ø§Ø´Øª Ø¨Ø±Ø§ÛŒ Ø¨Ø±Ø±Ø³ÛŒ
              </p>
            </section>

            <DrawerSection darkMode={darkMode} title="Ø±ÙˆÛŒØ¯Ø§Ø¯Ù‡Ø§">
              <div className="space-y-2">
                {drawerEvents.map((event) => (
                  <div
                    className={`rounded-xl border p-3 ${darkMode ? "border-white/10 bg-[#0b0f17]" : "border-slate-200 bg-white"}`}
                    key={event.time}
                  >
                    <p className="text-xs font-black text-[var(--theme-primary-text)]">
                      {event.time}
                    </p>
                    <p className="mt-1 text-sm font-bold leading-6">
                      {event.title}
                    </p>
                  </div>
                ))}
              </div>
            </DrawerSection>

            <DrawerSection darkMode={darkMode} title="ÛŒØ§Ø¯Ø¯Ø§Ø´Øªâ€ŒÙ‡Ø§">
              <div className="space-y-2">
                {drawerNotes.map((note) => (
                  <p
                    className={`rounded-xl border p-3 text-sm leading-6 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
                    key={note}
                  >
                    {note}
                  </p>
                ))}
              </div>
            </DrawerSection>

            <DrawerSection
              darkMode={darkMode}
              title={type === "messages" ? "Ù¾ÛŒØ§Ù…â€ŒÙ‡Ø§ÛŒ Ø§Ø®ÛŒØ±" : "Ø§Ø¹Ù„Ø§Ù†â€ŒÙ‡Ø§ÛŒ Ø§Ø®ÛŒØ±"}
            >
              <div className="space-y-2">
                {type === "messages"
                  ? messages.map((message) => (
                      <div
                        className={`rounded-xl border p-3 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
                        key={message.name}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-black">{message.name}</p>
                          {message.unread && (
                            <span className="h-2.5 w-2.5 rounded-full bg-[var(--theme-primary)]" />
                          )}
                        </div>
                        <p
                          className={`mt-2 text-xs leading-5 ${mutedText(darkMode)}`}
                        >
                          {message.text}
                        </p>
                      </div>
                    ))
                  : notifications.map((notification) => (
                      <div
                        className={`rounded-xl border p-3 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
                        key={notification.title}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-black">
                            {notification.title}
                          </p>
                          {notification.unread && (
                            <span className="h-2.5 w-2.5 rounded-full bg-[var(--theme-primary)]" />
                          )}
                        </div>
                        <p
                          className={`mt-2 text-xs leading-5 ${mutedText(darkMode)}`}
                        >
                          {notification.text}
                        </p>
                      </div>
                    ))}
              </div>
            </DrawerSection>

            <DrawerSection darkMode={darkMode} title="ØªÙ†Ø¸ÛŒÙ…Ø§Øª Ø³Ø±ÛŒØ¹">
              <div className="space-y-2">
                {quickSettings.map((setting, index) => (
                  <label
                    className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 text-sm font-bold ${
                      darkMode
                        ? "border-white/10 bg-white/5"
                        : "border-slate-200 bg-slate-50"
                    }`}
                    key={setting}
                  >
                    <span>{setting}</span>
                    <span
                      className={`h-6 w-10 rounded-full p-1 transition ${index === 0 ? "bg-[var(--theme-primary)]" : darkMode ? "bg-white/10" : "bg-slate-200"}`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition ${index === 0 ? "translate-x-0" : "-translate-x-4"}`}
                      />
                    </span>
                  </label>
                ))}
              </div>
            </DrawerSection>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DrawerSection({
  children,
  darkMode,
  title,
}: {
  children: ReactNode;
  darkMode: boolean;
  title: string;
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-black">{title}</h3>
      <div className={darkMode ? "text-slate-100" : "text-slate-800"}>
        {children}
      </div>
    </section>
  );
}

function HeaderIcon({
  active,
  children,
  label,
  darkMode,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  darkMode: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`relative grid h-10 w-10 place-items-center rounded-xl border transition hover:border-[var(--theme-primary)] ${
        active
          ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)] text-[var(--theme-primary-text)]"
          : darkMode
            ? "border-white/10 bg-white/5"
            : "border-slate-200 bg-slate-50"
      }`}
      onClick={onClick}
      type="button"
      aria-label={label}
      aria-pressed={active}
    >
      {children}
      <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--theme-primary)]" />
    </button>
  );
}

function surfaceClass(darkMode: boolean) {
  return darkMode
    ? "border-white/10 bg-[#171d27]"
    : "border-slate-200 bg-white";
}

function mutedText(darkMode: boolean) {
  return darkMode ? "text-slate-400" : "text-slate-500";
}



