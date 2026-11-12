import type { ReactNode } from "react";
import { AccountWorkspace } from "@/components/account/AccountWorkspace";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AccountWorkspace>{children}</AccountWorkspace>;
}
