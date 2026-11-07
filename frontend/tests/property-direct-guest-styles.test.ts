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
    const luminance = (hex: string, brightness = 1) => {
      const channels = hex.match(/[a-f\d]{2}/gi)!.map((part) => Math.min(1, parseInt(part, 16) / 255 * brightness))
        .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    expect(css).toContain("--pd-button-text: #ffffff");
    for (const token of ["top", "shoulder", "middle", "base"]) {
      const hex = css.match(new RegExp(`--pd-button-${token}:\\s*(#[a-f\\d]{6})`, "i"))![1];
      expect(1.05 / (luminance(hex.slice(1)) + .05)).toBeGreaterThanOrEqual(4.5);
      expect(1.05 / (luminance(hex.slice(1), 1.05) + .05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses one explicit antique-gold CTA recipe without blanket primary-button recoloring", () => {
    const css = source("PropertyDirectGuest.module.css");
    const selector = '.scope :is(.goldAction, button[data-booking-primary="true"])';
    expect(css).toContain(selector);
    expect(css).not.toContain('button:global(.bg-primary)');
    expect(css).toContain('border-radius: 4px');
    expect(css).toContain('var(--pd-button-shoulder) 18%, var(--pd-button-middle) 52%');
    expect(css).toContain('inset 0 -2px 0');
    expect(css).toContain('0 6px 12px');
    expect(css).toContain('filter: brightness(1.05)');
    expect(css).toContain('transform: translateY(-1px)');
    expect(css).toContain(`${selector}:focus-visible { outline: 2px solid var(--ring)`);
    expect(css).toMatch(/:is\(:disabled, \[aria-disabled="true"\]\)\s*\{\s*opacity: 1;/);
    expect(css).toContain(`${selector}:is(:hover, :active):not(:disabled):not([aria-disabled="true"]) { transform: none; }`);
    expect(css).not.toMatch(/url\(|feTurbulence|repeating-linear-gradient/);
    expect(source("PropertyBookingLanding.module.css")).toContain('--pd-cta-min-height: 52px');
    expect(css).toContain('--pd-cta-min-height: 48px');
    for (const file of ["PropertyBookingPanel.tsx", "PublicRoomTypeCard.tsx", "BookingCart.tsx", "BookingCheckoutFlow.tsx", "CheckoutIdentityStep.tsx"]) {
      expect(source(file)).toContain("data-booking-primary=");
      expect(source(file)).not.toContain('import styles from "./PropertyDirectGuest.module.css"');
    }
  });

  it("provides translucent dark glass with an opaque fallback and bounded optional frost", () => {
    const tokens = source("PropertyDirectGuest.module.css");
    const landing = source("PropertyBookingLanding.module.css");
    expect(tokens).toContain("--pd-glass-fallback: #1a1418;");
    expect(tokens).toContain("--pd-glass: color-mix(in srgb, var(--pd-glass-fallback) 68%, transparent);");
    expect(tokens).toContain("--pd-glass-edge: color-mix(in srgb, var(--pd-bronze) 28%, transparent);");
    const [fallback, supports] = landing.split("@supports");
    for (const selector of [".header", ".search > div:first-child"]) {
      const rule = fallback.slice(fallback.indexOf(`${selector} {`)).split("}")[0];
      expect(rule).toContain("background: var(--pd-glass-fallback)");
      expect(rule).toContain("var(--pd-glass-highlight)");
      expect(rule).not.toContain("opacity:");
      expect(rule).not.toContain("backdrop-filter:");
    }
    expect(supports).toContain(".header, .search > div:first-child { background: var(--pd-glass); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }");
    expect(landing).not.toMatch(/(?:backdrop-filter|filter)\s*:[^;]*(?:20|30|40)px/);

    // Even over white imagery, the glass alone keeps primary ivory text readable.
    const channels = (hex: string) => hex.match(/[a-f\d]{2}/gi)!.map((part) => parseInt(part, 16) / 255);
    const luminance = (rgb: number[]) => rgb.map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const background = channels("1a1418").map((v) => v * .68 + .32);
    expect((luminance(channels("f2e7d9")) + .05) / (luminance(background) + .05)).toBeGreaterThanOrEqual(4.5);
  });
});
