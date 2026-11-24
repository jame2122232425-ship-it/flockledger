import Link from "next/link";

type LegalPageKey = "privacy" | "terms" | "security";

export default function LegalPageContent({ page }: { page: LegalPageKey }) {
  return (
    <div className="marketing-prose">
      <p className="legal-draft-notice" role="note">
        Draft for review. These pages describe intended practices and must be checked and approved before publication.
      </p>

      {page === "privacy" && (
        <>
          <section className="marketing-card">
            <h2>Information this service handles</h2>
            <p>FlockLedger processes account details such as your name and email address, along with the authentication information needed to sign in. Password authentication is handled by our authentication provider.</p>
            <p>When you use the service, farm owners and team members may enter farm names, flock and batch records, health and treatment details, feed and inventory activity, sales, payments, expenses, and staff invitations and roles.</p>
          </section>
          <section className="marketing-card">
            <h2>How information is used</h2>
            <p>Information is used to provide farm workspaces, keep records associated with the right farm, manage team access, display reports, support account operation, and respond to support requests.</p>
            <p>FlockLedger uses Supabase for authentication and database hosting. Information may be processed by service providers needed to operate the application, or disclosed when legally required.</p>
          </section>
          <section className="marketing-card">
            <h2>Farm access, retention, and your choices</h2>
            <p>Farm records are available to signed-in users with access to that farm. Farm owners manage membership and roles. Do not include information in farm records that you are not authorized to share with the farm team.</p>
            <p>This draft proposes retaining information while the account or farm is active and as needed for service, security, and legal requirements. To ask about accessing, correcting, or deleting account information, contact <a href="mailto:support@flockledger.co.ke">support@flockledger.co.ke</a>.</p>
          </section>
          <section className="marketing-card">
            <h2>Cookies and changes</h2>
            <p>FlockLedger uses authentication session cookies needed to keep users signed in. This draft does not describe analytics or advertising cookies; confirm any additional website tools before publication.</p>
            <p>We may update this policy as the service changes. The final policy should state how users will be notified of material changes and when they take effect.</p>
          </section>
        </>
      )}

      {page === "terms" && (
        <>
          <section className="marketing-card">
            <h2>Using FlockLedger</h2>
            <p>FlockLedger provides digital tools for poultry farm records and team workflows. Use the service lawfully, provide accurate account information, and keep your sign-in details secure.</p>
            <p>Farm owners are responsible for inviting the right people, assigning suitable roles, and removing access when a team member no longer needs it. Each user is responsible for activity performed through their account.</p>
          </section>
          <section className="marketing-card">
            <h2>Farm records and decisions</h2>
            <p>You and your farm retain responsibility for the information you enter and for deciding who may access it. You authorize FlockLedger to process that information as needed to provide the service.</p>
            <p>Reports and calculations are operational aids, not veterinary, legal, or financial advice. Verify important records and use qualified professional advice for animal health, medication, food safety, and business decisions.</p>
          </section>
          <section className="marketing-card">
            <h2>Plans, trials, and service changes</h2>
            <p>Plan descriptions and displayed prices are provided on the <Link href="/pricing">Pricing page</Link>. Paid billing, trial conditions, cancellation, refunds, and any plan-specific limits must be confirmed in the final terms before paid subscriptions are offered.</p>
            <p>We may update or discontinue parts of the service. The final terms should explain how material changes and service availability will be handled.</p>
          </section>
          <section className="marketing-card">
            <h2>Suspension, termination, and contact</h2>
            <p>Users may stop using the service and may contact support to request account closure. The final terms should state when access may be suspended, how account closure works, and how farm data is handled afterward.</p>
            <p>For questions about these draft terms, email <a href="mailto:support@flockledger.co.ke">support@flockledger.co.ke</a>.</p>
          </section>
          <section className="marketing-card">
            <h2>Details requiring approval</h2>
            <p>Before publication, the service operator’s legal name, governing law, liability limits, dispute process, and any required statutory notices must be confirmed by the operator and legal counsel.</p>
          </section>
        </>
      )}

      {page === "security" && (
        <>
          <section className="marketing-card">
            <h2>Account and farm access</h2>
            <p>Users sign in through Supabase Authentication. Farm membership and roles are used to control access to farm workspaces and records, with database row-level security policies applied to farm data.</p>
            <p>Farm owners should use appropriate roles, invite only trusted team members, and remove access when it is no longer needed. Users should choose unique passwords and keep setup links and sign-in details private.</p>
          </section>
          <section className="marketing-card">
            <h2>Infrastructure and safeguards</h2>
            <p>FlockLedger uses Supabase for authentication and database hosting. Access credentials for privileged server operations are kept on the server and are not intended for public client-side use.</p>
            <p>Security depends on the application, its configuration, and its service providers. No online service can guarantee absolute security; specific certifications, backup practices, and incident-response commitments should be confirmed before publication.</p>
          </section>
          <section className="marketing-card">
            <h2>Report a security concern</h2>
            <p>If you believe an account or farm record has been accessed improperly, contact <a href="mailto:support@flockledger.co.ke">support@flockledger.co.ke</a> with relevant details. Do not include passwords or other sensitive credentials in your message.</p>
          </section>
        </>
      )}
    </div>
  );
}
