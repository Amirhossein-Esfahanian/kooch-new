import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchSeo: vi.fn().mockResolvedValue({
    title: "عنوان سروری",
    description: "توضیحات سروری",
  }),
}));

vi.mock("@/lib/site-settings.server", () => ({
  fetchDefaultSeoMetadata: mocks.fetchSeo,
}));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  AuthSessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  OwnerPropertyProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("sonner", () => ({ Toaster: () => null }));
vi.mock("@/app/fonts", () => ({ iranYekan: { variable: "font-test" } }));

import { generateMetadata } from "@/app/layout";

describe("root metadata", () => {
  it("uses server Site Settings while preserving the title template", async () => {
    await expect(generateMetadata()).resolves.toEqual({
      title: {
        default: "عنوان سروری",
        template: "%s | Kooch",
      },
      description: "توضیحات سروری",
    });
  });
});
