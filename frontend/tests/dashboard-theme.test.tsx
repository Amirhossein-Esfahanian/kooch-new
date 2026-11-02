import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { dashboardThemeStorageKey, useDashboardTheme } from "@/lib/dashboard-theme";

function ThemeProbe({ onRender }: { onRender?: (mode: string) => void }) {
  const { darkMode, ready, toggleTheme } = useDashboardTheme();
  const mode = ready ? darkMode ? "dark" : "light" : "pending";
  onRender?.(mode);
  return <button onClick={toggleTheme} data-mode={mode}>theme</button>;
}

describe("dashboard theme", () => {
  it.each(["light", "dark"])("restores an explicit %s preference on reload without overwriting it", (mode) => {
    localStorage.setItem(dashboardThemeStorageKey, mode);
    const write = vi.spyOn(Storage.prototype, "setItem");
    const view = render(<ThemeProbe />);
    expect(screen.getByRole("button").getAttribute("data-mode")).toBe(mode);
    view.unmount();
    render(<ThemeProbe />);
    expect(screen.getByRole("button").getAttribute("data-mode")).toBe(mode);
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("shares updates between mounted consumers and browser tabs", () => {
    render(<><ThemeProbe /><ThemeProbe /></>);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(localStorage.getItem(dashboardThemeStorageKey)).toBe("dark");
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("data-mode"))).toEqual(["dark", "dark"]);
    act(() => {
      localStorage.setItem(dashboardThemeStorageKey, "light");
      window.dispatchEvent(new StorageEvent("storage", { key: dashboardThemeStorageKey }));
    });
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("data-mode"))).toEqual(["light", "light"]);
  });

  it("preserves the existing light default rather than introducing a system-theme policy", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      localStorage.setItem(dashboardThemeStorageKey, "invalid");
      render(<ThemeProbe />);
      expect(screen.getByRole("button").getAttribute("data-mode")).toBe("light");
      expect(matchMedia).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the choice across remounts if persisting it fails", () => {
    const view = render(<ThemeProbe />);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    try {
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByRole("button").getAttribute("data-mode")).toBe("dark");
      view.unmount();
      render(<ThemeProbe />);
      expect(screen.getByRole("button").getAttribute("data-mode")).toBe("dark");
    } finally {
      write.mockRestore();
      // Return the memory fallback to the default and clear the failed-write override.
      fireEvent.click(screen.getByRole("button"));
    }
    expect(localStorage.getItem(dashboardThemeStorageKey)).toBe("light");
  });

  it("does not change the document theme, accent palette or unrelated page markup", () => {
    localStorage.setItem("kooch_theme", "forest");
    const html = document.documentElement.getAttribute("class");
    const body = document.body.getAttribute("class");
    const palette = document.documentElement.getAttribute("data-theme");
    render(<><div data-testid="public">Public page</div><ThemeProbe /></>);
    const publicMarkup = screen.getByTestId("public").outerHTML;
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.getAttribute("class")).toBe(html);
    expect(document.body.getAttribute("class")).toBe(body);
    expect(document.documentElement.getAttribute("data-theme")).toBe(palette);
    expect(localStorage.getItem("kooch_theme")).toBe("forest");
    expect(screen.getByTestId("public").outerHTML).toBe(publicMarkup);
  });

  it("hydrates using a pending snapshot, then dark, never a light dashboard", async () => {
    localStorage.setItem(dashboardThemeStorageKey, "dark");
    const onRender = vi.fn();
    const container = document.createElement("div");
    container.innerHTML = renderToString(<ThemeProbe />);
    expect(container.querySelector("button")?.getAttribute("data-mode")).toBe("pending");
    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, <ThemeProbe onRender={onRender} />); });
      expect(container.querySelector("button")?.getAttribute("data-mode")).toBe("dark");
      expect(onRender.mock.calls.map(([mode]) => mode)).not.toContain("light");
      expect(errors).not.toHaveBeenCalled();
    } finally {
      act(() => root?.unmount());
      container.remove();
      errors.mockRestore();
    }
  });
});
