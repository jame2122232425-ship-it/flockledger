import Link from "next/link";
import type { ReactNode } from "react";
import {
  LandingNavActions,
  LandingSessionProvider,
} from "@/components/landing-session";
import { MobileNavMenu } from "@/components/mobile-navigation";
import LegalPageContent from "@/components/legal-page-content";
import PricingContent from "@/components/pricing-content";

type MarketingPageKey = "pricing" | "guides" | "faq" | "about" | "contact" | "blog" | "privacy" | "terms" | "security";

const pageDetails: Record<MarketingPageKey, { eyebrow: string; title: string; summary: string }> = {
  pricing: {
    eyebrow: "Simple, transparent pricing",
    title: "Subscription options for your poultry farm.",
    summary: "Compare plans and farm entitlements. Eligible Starter farms can request a no-payment Professional trial; paid pricing and online checkout are not yet available.",
  },
  guides: {
    eyebrow: "FlockLedger guides",
    title: "Practical guides for better farm records",
    summary: "Get started with the records and workflows that help you understand each batch.",
  },
  faq: {
    eyebrow: "Frequently asked questions",
    title: "Answers for your farm",
    summary: "Learn how accounts, farm roles, records, and data access work in FlockLedger.",
  },
  about: {
    eyebrow: "About FlockLedger",
    title: "Built around the real work of poultry farming",
    summary: "FlockLedger brings flock activity, health, stock, and financial records into one farm workspace.",
  },
  contact: {
    eyebrow: "Contact our team",
    title: "How can we help your farm?",
    summary: "Questions about getting started, your account, or using FlockLedger? Get in touch.",
  },
  blog: {
    eyebrow: "From the FlockLedger team",
    title: "Notes for running a better-recorded farm",
    summary: "Ideas and practical advice for poultry record keeping, batch performance, and farm operations.",
  },
  privacy: {
    eyebrow: "Legal · Draft",
    title: "Privacy Policy",
    summary: "How FlockLedger handles account and farm information. Draft for review.",
  },
  terms: {
    eyebrow: "Legal · Draft",
    title: "Terms of Service",
    summary: "Draft terms for using FlockLedger farm workspaces and services.",
  },
  security: {
    eyebrow: "Trust · Draft",
    title: "Data Security",
    summary: "An overview of access controls and security practices in FlockLedger. Draft for review.",
  },
};

function PageBody({ page }: { page: MarketingPageKey }) {
  if (page === "privacy" || page === "terms" || page === "security") {
    return <LegalPageContent page={page} />;
  }

  if (page === "guides") {
    return (
      <>
        <section className="marketing-card" id="farm-setup">
          <span className="marketing-step">01</span>
          <h2>Set up your farm workspace</h2>
          <p>Create an owner account, add your farm, and invite the people who help run it. Assign each team member a role that matches their work.</p>
          <p className="marketing-note">Owners manage farm access. Workers use the Attendant role.</p>
        </section>
        <section className="marketing-card" id="start-a-batch">
          <span className="marketing-step">02</span>
          <h2>Start a batch</h2>
          <p>Record the batch type, placement date, house, and number of chicks received. FlockLedger creates a batch ID for your records.</p>
        </section>
        <section className="marketing-card" id="daily-records">
          <span className="marketing-step">03</span>
          <h2>Keep daily records</h2>
          <p>Log deaths, culls, feed given and left over, water, house temperatures, litter, and notes. Regular entries help keep the batch history useful.</p>
        </section>
        <section className="marketing-card" id="health-and-sales">
          <span className="marketing-step">04</span>
          <h2>Record health and sales</h2>
          <p>Keep treatment and vaccination details with the flock record, including withdrawal periods. Record sales and payments to follow revenue and balances.</p>
        </section>
      </>
    );
  }

  if (page === "faq") {
    return (
      <div className="marketing-faq-list">
        <details>
          <summary>Who can create a farm?</summary>
          <p>A signed-in owner can create a farm. The account that creates it becomes its owner.</p>
        </details>
        <details>
          <summary>How do I add workers?</summary>
          <p>The farm owner creates staff accounts, assigns a role, and shares the setup link and temporary password. Staff set a new password when they first open the link.</p>
        </details>
        <details>
          <summary>Which roles are available?</summary>
          <p>Farm roles are Owner, Manager, Attendant, Veterinarian, and Accountant. Workers use the Attendant role.</p>
        </details>
        <details>
          <summary>What can I record in FlockLedger?</summary>
          <p>FlockLedger supports batch, daily house, weight, health, feed, stock, sales, payment, cash, and other farm-operation records.</p>
        </details>
        <details>
          <summary>Which currency and timezone are used?</summary>
          <p>Farm financial records use Kenyan shillings (KES), and the default farm timezone is Africa/Nairobi.</p>
        </details>
        <details>
          <summary>How is farm data protected?</summary>
          <p>Users access records through their signed-in account. Farm membership and role permissions are enforced by the database.</p>
        </details>
        <details>
          <summary>Are subscriptions or paid plans required?</summary>
          <p>No. Subscription and plan enforcement are currently inactive. Approved, active farms can use features allowed by their farm roles.</p>
        </details>
      </div>
    );
  }

  if (page === "about") {
    return (
      <div className="marketing-prose">
        <section className="marketing-card">
          <h2>One place for the whole flock record</h2>
          <p>Poultry farms make decisions every day about bird health, feed, stock, sales, and costs. When the supporting records are scattered across paper sheets and separate files, it becomes harder to see how a batch is performing.</p>
          <p>FlockLedger brings these records together by farm and batch, so owners and their teams can keep a shared history as the flock grows.</p>
        </section>
        <section className="marketing-card">
          <h2>Made for shared farm work</h2>
          <p>Owners can create a farm workspace and control who has access. Managers, attendants, veterinarians, and accountants can use role-based access suited to their responsibilities.</p>
          <p>FlockLedger is built for broiler and kienyeji farm record keeping, with Kenyan shillings and Africa/Nairobi as the default financial and timezone settings.</p>
        </section>
        <div className="marketing-inline-cta">
          <p>Ready to bring your records together?</p>
          <Link className="landing-button landing-button-amber" href="/signup">Create your farm account</Link>
        </div>
      </div>
    );
  }

  if (page === "contact") {
    return (
      <div className="marketing-contact-grid">
        <section className="marketing-card">
          <span className="marketing-card-label">Email support</span>
          <h2>Tell us what you need</h2>
          <p>For help with setup, account access, or farm records, email our support team. Including your farm name and the email on your account can help us understand your question.</p>
          <a className="landing-button landing-button-amber" href="mailto:support@flockledger.co.ke">Email support</a>
          <p className="marketing-contact-value">support@flockledger.co.ke</p>
        </section>
        <section className="marketing-card">
          <span className="marketing-card-label">Getting started</span>
          <h2>Explore FlockLedger</h2>
          <p>Learn about the workflows, set up your farm, or review common questions before you begin.</p>
          <div className="marketing-link-list">
            <Link href="/guides">Read the farm guides</Link>
            <Link href="/faq">Visit frequently asked questions</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      <article className="marketing-card marketing-article">
        <span className="marketing-card-label">Record keeping</span>
        <h2>Why consistent daily flock records matter</h2>
        <p>Daily records turn small observations into a batch history you can review. Track bird losses, feed use, water, and house conditions together to spot changes and keep everyone working from the same information.</p>
        <Link href="/guides#daily-records">Read the daily records guide</Link>
      </article>
      <article className="marketing-card marketing-article">
        <span className="marketing-card-label">Batch management</span>
        <h2>Start each batch with a clear baseline</h2>
        <p>Placement date, flock type, house, and chick count give each batch its starting context. Keeping these details alongside later activity makes closeout and comparisons more meaningful.</p>
        <Link href="/guides#start-a-batch">Read the batch setup guide</Link>
      </article>
      <article className="marketing-card marketing-article">
        <span className="marketing-card-label">Farm operations</span>
        <h2>Keep health and sales records connected</h2>
        <p>Recording treatments, withdrawal periods, sales, and payments helps preserve the context behind important farm decisions and the revenue recorded for a flock.</p>
        <Link href="/guides#health-and-sales">Read the health and sales guide</Link>
      </article>
    </>
  );
}

function MarketingNav() {
  return (
    <nav className="landing-nav" aria-label="Main navigation">
      <Link className="landing-brand" href="/" aria-label="FlockLedger home">
        <span className="landing-brand-mark" aria-hidden="true">F</span>
        <span>FlockLedger</span>
      </Link>
      <div className="landing-nav-links">
        <Link href="/#features">Features</Link>
        <Link href="/guides">Guides</Link>
        <Link href="/faq">FAQ</Link>
      </div>
      <div className="landing-nav-actions">
        <MobileNavMenu featuresHref="/#features" />
        <LandingNavActions />
      </div>
    </nav>
  );
}

function MarketingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-container landing-footer-grid">
        <div className="landing-footer-brand">
          <Link className="landing-brand" href="/" aria-label="FlockLedger home">
            <span className="landing-brand-mark" aria-hidden="true">F</span>
            <span>FlockLedger</span>
          </Link>
          <p>Better poultry records. Better farm decisions.</p>
        </div>
        <div><strong>Product</strong><Link href="/#features">Features</Link><Link href="/guides">Guides</Link></div>
        <div><strong>Company</strong><Link href="/about">About Us</Link><Link href="/contact">Contact</Link><Link href="/blog">Blog</Link></div>
        <div><strong>Legal</strong><Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms of Service</Link><Link href="/security">Data Security</Link></div>
        <div><strong>Contact</strong><a href="mailto:support@flockledger.co.ke">Support email</a><Link href="/contact">Contact us</Link></div>
      </div>
      <div className="landing-container landing-footer-bottom">© 2026 FlockLedger. All rights reserved.</div>
    </footer>
  );
}

export default function MarketingPage({ page }: { page: MarketingPageKey }) {
  const details = pageDetails[page];
  let content: ReactNode = page === "pricing"
    ? <PricingContent eyebrow={details.eyebrow} title={details.title} summary={details.summary} />
    : <PageBody page={page} />;

  if (page === "guides" || page === "blog") {
    content = <div className="marketing-card-grid">{content}</div>;
  }

  return (
    <LandingSessionProvider>
      <div className="landing">
        <MarketingNav />
        <main className="marketing-main">
          {page === "pricing" ? content : (
            <>
              <header className={`marketing-page-hero marketing-page-hero-${page}`}>
                <div className="landing-container">
                  <p className="landing-eyebrow">{details.eyebrow}</p>
                  <h1>{details.title}</h1>
                  <p>{details.summary}</p>
                </div>
              </header>
              <section className={`landing-container marketing-content marketing-content-${page}`}>
                {content}
              </section>
            </>
          )}
        </main>
        <MarketingFooter />
      </div>
    </LandingSessionProvider>
  );
}
