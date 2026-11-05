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

  it("scopes theme tokens and limits optional blur to the floating menu", () => {
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
});
