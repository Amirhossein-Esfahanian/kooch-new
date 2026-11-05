import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(resolve(process.cwd(), "components/booking", name), "utf8");

describe("Property Direct presentation isolation", () => {
  it("keeps the auth-only wrapper behind a dynamic import and mounts it on demand", () => {
    const account = source("PropertyGuestAccount.tsx");
    expect(account).toContain('dynamic(() => import("./PropertyGuestAuthDialog")');
    expect(account).toContain("open && !auth.authenticated");
    expect(account).not.toMatch(/import .*CheckoutIdentityStep/);
  });

  it("scopes theme tokens and limits optional blur to bounded surfaces", () => {
    const css = source("PropertyDirectGuest.module.css");
    expect(css).not.toContain(":root");
    expect(css).not.toMatch(/:global\((body|html)\)/);
    expect(css).toContain("@supports");
    expect(css).toContain(".navigation .menu { background: color-mix");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("max-height: calc(100dvh");
    expect(css).toContain("height: auto");
    const sharedMenu = readFileSync(resolve(process.cwd(), "components/KoochUserMenu.tsx"), "utf8");
    expect(sharedMenu).not.toContain("PropertyDirectGuest.module.css");
  });

  it("opts Direct surfaces and its checkout portal into the same private palette", () => {
    const css = source("PropertyDirectGuest.module.css");
    expect(css).toContain("--pd-paper: #0f0b0d");
    expect(css).toContain("--pd-accent: #d3ad77");
    expect(css).toContain("color-scheme: dark");
    expect(css).toContain("--control-surface: var(--pd-card)");
    expect(css).toContain("--theme-primary-soft: var(--pd-elevated)");
    expect(source("PropertyBookingLanding.tsx")).toContain("guestStyles.scope");
    expect(source("PropertyBookingShell.tsx")).toContain("styles.scope");
    expect(source("PropertyGuestAuthDialog.tsx")).toContain("styles.scope");
    expect(source("PropertyDirectCheckoutDialog.tsx")).toContain("${contentClassName}");
    expect(source("PropertyBookingLanding.tsx")).toContain("portalClassName=");
  });

  it("passes checkout presentation only for the Direct entry without a shared CSS import", () => {
    const panel = source("PropertyBookingPanel.tsx");
    expect(panel).toContain('entryKind === "book" && <PropertyDirectCheckoutDialog');
    expect(panel).toContain("contentClassName={portalClassName}");
    expect(panel).not.toContain("PropertyDirectGuest.module.css");
    expect(source("PropertyDirectCheckoutDialog.tsx")).not.toContain("PropertyDirectGuest.module.css");
  });

  it("uses readable white text on every opaque gold button gradient stop", () => {
    const css = source("PropertyDirectGuest.module.css");
    const luminance = (hex: string) => {
      const channels = hex.match(/[a-f\d]{2}/gi)!.map((part) => parseInt(part, 16) / 255)
        .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    expect(css).toContain("--pd-button-text: #ffffff");
    for (const token of ["top", "base", "hover"]) {
      const hex = css.match(new RegExp(`--pd-button-${token}:\\s*(#[a-f\\d]{6})`, "i"))![1];
      expect(1.05 / (luminance(hex.slice(1)) + .05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
