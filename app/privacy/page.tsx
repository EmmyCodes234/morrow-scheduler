export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background-full py-12 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="size-9 rounded-xl bg-accent-500 text-white flex items-center justify-center font-bold text-headline-medium shadow-2xs">
          M
        </div>
        <span className="text-title-2-medium text-text-primary">Morrow Privacy Policy</span>
      </div>

      <div className="rounded-3xl border border-border-button-default bg-background-primary-default p-8 sm:p-10 flex flex-col gap-6 shadow-sm text-text-secondary text-body-medium">
        <p className="text-body-2-regular text-text-tertiary">Last updated: November 2, 2026</p>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">1. Overview</h2>
          <p>
            Morrow (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;usemorrow.xyz&rdquo;) is an autonomous scheduling platform designed to make booking meetings seamless and delightful. This Privacy Policy describes how we handle information collected when you connect your Google account or book time through Morrow.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">2. Google API Data &amp; Scopes</h2>
          <p>
            Morrow connects to Google Calendar via OAuth 2.0 to provide scheduling automation. Specifically, we request:
          </p>
          <ul className="list-disc list-inside ps-2 flex flex-col gap-1.5 text-body-2-regular">
            <li>
              <strong className="text-text-primary">Google Calendar Readonly:</strong> Used exclusively to check your free and busy times. We do not store details, subjects, or attendee lists of your unrelated calendar events.
            </li>
            <li>
              <strong className="text-text-primary">Google Calendar Events:</strong> Used to create confirmed calendar events and generate Google Meet video conference links when a guest books time with you.
            </li>
          </ul>
          <p className="pt-1">
            Morrow&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-500 hover:underline font-medium"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">3. Information We Collect</h2>
          <ul className="list-disc list-inside ps-2 flex flex-col gap-1.5 text-body-2-regular">
            <li><strong className="text-text-primary">Host Information:</strong> Name, email address, avatar photo from your OAuth provider, custom availability settings, and event configurations.</li>
            <li><strong className="text-text-primary">Guest Information:</strong> Name, email address, and optional meeting notes provided during booking.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">4. Data Security &amp; Retention</h2>
          <p>
            All OAuth tokens and user data are securely encrypted in transit and at rest using Neon serverless database infrastructure. We never sell, rent, or monetize personal data or calendar information to third parties or advertisers.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-title-3-semibold text-text-primary">5. Contact</h2>
          <p>
            For questions regarding your data or to request account deletion, contact us at{" "}
            <a href="mailto:support@usemorrow.xyz" className="text-accent-500 hover:underline font-medium">
              support@usemorrow.xyz
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
