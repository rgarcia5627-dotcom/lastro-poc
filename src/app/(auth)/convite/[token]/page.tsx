import { SignupForm } from "@/components/auth-forms";
import { findValidInvite } from "@/lib/invites";

export const metadata = { title: "Convite de administrador" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findValidInvite(token);
  if (!invite) {
    return (
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">Convite inválido</h1>
        <p className="text-sm text-muted">Este convite expirou ou já foi usado. Peça um novo para a equipe Lastro.</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Acesso de administrador</h1>
        <p className="mt-1 text-sm text-muted">Crie a passkey que dará acesso à área de gestão da Lastro.</p>
      </div>
      <SignupForm inviteToken={token} inviteEmail={invite.email} />
    </div>
  );
}
