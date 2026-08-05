import { cleanup } from "@testing-library/react";
import { resetSessionRevocationStateForTests } from "@/lib/auth-session";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  resetSessionRevocationStateForTests();
});
