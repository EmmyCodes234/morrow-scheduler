export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background-full py-12 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="size-9 rounded-xl bg-accent-500 text-white flex items-center justify-center font-bold text-headline-medium shadow-2xs">
          M
        </div>
        <span className="text-title-2-medium text-text-primary">Morrow Terms of Service</span>
      </div>

      <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-8 sm:p-10 flex flex-col gap-6 shadow-sm text-text-secondary text-body-medium">
        <p className="text-body-2-regular text-text-tertiary">Last updated: November 2, 2026</p>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">1. Agreement to Terms</h2>
          <p>
            By accessing or using Morrow (&ldquo;usemorrow.xyz&rdquo;), you agree to be bound by these Terms of Service. If you disagree with any part of these terms, you may not use our service.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">2. Description of Service</h2>
          <p>
            Morrow provides automated appointment scheduling, calendar synchronization, and video conferencing link generation for individuals and teams.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">3. User Responsibilities</h2>
          <p>
            You are responsible for maintaining the security of your account and credentials. You agree not to use the service for spam, unauthorized advertising, or any unlawful activities.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">4. Cancellation &amp; Termination</h2>
          <p>
            You may disconnect your calendar integration or request deletion of your Morrow account at any time through the Settings panel or by contacting support.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">5. Contact</h2>
          <p>
            For any inquiries regarding these terms, please contact{" "}
            <a href="mailto:support@usemorrow.xyz" className="text-accent-500 hover:underline font-medium">
              support@usemorrow.xyz
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
