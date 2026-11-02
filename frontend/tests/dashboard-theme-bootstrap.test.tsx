import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardThemeBootstrap, dashboardThemeStorageKey } from "@/lib/dashboard-theme-bootstrap";
import { useDashboardTheme } from "@/lib/dashboard-theme";

function bootstrap(pathname: string, value: string | null, blocked = false) {
  const storage = { getItem: vi.fn(() => { if (blocked) throw new Error("blocked"); return value; }) };
  // Execute the exact static head payload without requiring a running Next server.
  new Function("document", "location", "localStorage", dashboardThemeBootstrap)(document, { pathname }, storage);
  return storage;
}

function Probe() {
  const { darkMode, ready, toggleTheme } = useDashboardTheme();
  return <button data-mode={ready ? darkMode ? "dark" : "light" : "pending"} onClick={toggleTheme}>theme</button>;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-dashboard-mode");
  window.history.replaceState(null, "", "/");
});

describe("dashboard first-paint bootstrap", () => {
  it.each([
    ["/admin", "dark"], ["/admin/tasks", "light"],
    ["/owner", "light"], ["/owner/properties/11/dashboard", "dark"],
  ])("applies saved %s / %s before React mounts", (pathname, mode) => {
    const palette = document.documentElement.getAttribute("data-theme");
    const classes = document.documentElement.className;
    const storage = bootstrap(pathname, mode);
    expect(storage.getItem).toHaveBeenCalledWith(dashboardThemeStorageKey);
    expect(document.documentElement.getAttribute("data-dashboard-mode")).toBe(mode);
    expect(document.documentElement.className).toBe(classes);
    expect(document.documentElement.getAttribute("data-theme")).toBe(palette);
  });

  it.each(["/", "/properties/test", "/account", "/login", "/management-login", "/owner/login", "/admin/login", "/administrator"])("does nothing on %s", (pathname) => {
    const storage = bootstrap(pathname, "dark");
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute("data-dashboard-mode")).toBe(false);
  });

  it.each([null, "invalid", "system"])("defaults to light for %s without writing preferences", (value) => {
    bootstrap("/admin", value);
    expect(document.documentElement.getAttribute("data-dashboard-mode")).toBe("light");
  });

  it("handles blocked storage without stopping page initialization", () => {
    expect(() => bootstrap("/owner", null, true)).not.toThrow();
    expect(document.documentElement.getAttribute("data-dashboard-mode")).toBe("light");
  });

  it("places the blocking bootstrap in head and scopes dark tokens to the loading surface", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    const css = readFileSync("app/globals.css", "utf8");
    expect(layout).toMatch(/<head>\s*<script dangerouslySetInnerHTML=\{\{ __html: dashboardThemeBootstrap \}\} \/>\s*<\/head>\s*<body/);
    expect(css).toContain(':root[data-dashboard-mode="dark"] [data-dashboard-loading]');
    expect(css).toMatch(/html\[data-dashboard-mode="dark"\],\s*html\[data-dashboard-mode="dark"\] body\s*\{\s*background-color: var\(--dashboard-dark-background\);/);
  });

  it("keeps bootstrap and hydration consistent, then updates and removes the canvas marker", async () => {
    window.history.replaceState(null, "", "/admin/tasks");
    localStorage.setItem(dashboardThemeStorageKey, "dark");
    bootstrap("/admin/tasks", "dark");
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, <Probe />); });
      expect(container.querySelector("button")?.getAttribute("data-mode")).toBe("dark");
      expect(document.documentElement.getAttribute("data-dashboard-mode")).toBe("dark");
      fireEvent.click(container.querySelector("button")!);
      expect(document.documentElement.getAttribute("data-dashboard-mode")).toBe("light");
      expect(errors).not.toHaveBeenCalled();
    } finally {
      act(() => root?.unmount());
      container.remove();
      errors.mockRestore();
    }
    expect(document.documentElement.hasAttribute("data-dashboard-mode")).toBe(false);
  });

  it("clears the dashboard canvas when navigating to public/auth content", () => {
    window.history.replaceState(null, "", "/owner/properties/11/dashboard");
    localStorage.setItem(dashboardThemeStorageKey, "dark");
    const view = render(<Probe />);
    expect(document.documentElement.getAttribute("data-dashboard-mode")).toBe("dark");
    view.unmount();
    window.history.replaceState(null, "", "/owner/login");
    expect(document.documentElement.hasAttribute("data-dashboard-mode")).toBe(false);
    render(<div>login</div>);
    expect(screen.getByText("login").closest(".dark")).toBeNull();
  });
});
