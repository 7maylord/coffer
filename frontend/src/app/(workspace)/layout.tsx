import { AuthProviders } from "@/components/auth/auth-provider";
import { AuthenticatedWorkspace } from "@/components/auth/authenticated-workspace";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProviders>
      <AuthenticatedWorkspace>{children}</AuthenticatedWorkspace>
    </AuthProviders>
  );
}
