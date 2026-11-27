import Link from "next/link";
import {
  LandingCta,
  LandingHeroActions,
  LandingHeroFootnote,
  LandingNavActions,
  LandingSessionProvider,
} from "@/components/landing-session";
import { MobileNavMenu } from "@/components/mobile-navigation";

export const instant = false;

export default function Home() {
  return (
    <LandingSessionProvider>
    <main className="landing">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link className="landing-brand" href="/" aria-label="FlockLedger home">
          <span className="landing-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M7 14c-2.2 0-4-1.6-4-3.5S4.8 7 7 7c1.7 0 3.2.9 3.8 2.2 2.1-.6 4.2-.2 5.7 1.2l3.5-.2-1.7 2.1c.1 3.3-2.7 5.7-6.2 5.7H9l-3 2v-3.2A5.2 5.2 0 0 1 4 14.5" />
              <circle cx="7" cy="10" r=".7" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span>FlockLedger</span>
        </Link>
        <div className="landing-nav-links">
          <a href="#features">Features</a>
          <Link href="/guides">Guides</Link>
          <Link href="/faq">FAQ</Link>
        </div>
        <div className="landing-nav-actions">
          <MobileNavMenu />
          <LandingNavActions />
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-glow" />
        <div className="landing-container landing-hero-grid">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">Digital farm records, made practical</p>
            <h1>Stop guessing. Start tracking every bird, shilling, and bag of feed.</h1>
            <p className="landing-lede">
              The reliable, digital record-keeping system built for commercial broiler and kienyeji farms.
              Replace lost paper logs, track health and withdrawal periods, and know your exact profit per batch.
            </p>
            <div className="landing-hero-actions">
              <LandingHeroActions />
            </div>
            <LandingHeroFootnote />
          </div>

          <div className="landing-product-visual" aria-label="FlockLedger dashboard preview">
            <div className="landing-laptop">
              <div className="landing-laptop-screen">
                <div className="mock-sidebar">
                  <span className="mock-logo">FL</span>
                  <i /><i /><i /><i />
                </div>
                <div className="mock-workspace">
                  <div className="mock-topbar"><strong>Farm overview</strong><span>Nov 21</span></div>
                  <div className="mock-metrics">
                    <div><small>Live birds</small><strong>4,850</strong></div>
                    <div><small>Feed stock</small><strong>2.4 t</strong></div>
                    <div><small>Farm profit</small><strong>KES 186k</strong></div>
                  </div>
                  <div className="mock-chart">
                    <span style={{ height: "38%" }} /><span style={{ height: "54%" }} />
                    <span style={{ height: "49%" }} /><span style={{ height: "73%" }} />
                    <span style={{ height: "68%" }} /><span style={{ height: "88%" }} />
                  </div>
                </div>
              </div>
              <div className="landing-laptop-base" />
            </div>
            <div className="landing-phone">
              <div className="landing-phone-notch" />
              <p>Daily entry</p>
              <strong>House 2</strong>
              <label>Deaths <b>3</b></label>
              <label>Feed given <b>240 kg</b></label>
              <button type="button">Save record</button>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-container">
          <div className="landing-section-heading landing-section-heading-centered">
            <p className="landing-eyebrow">A better way to record</p>
            <h2>Paper gets lost. Excel breaks. Your farm deserves better.</h2>
          </div>
          <div className="problem-solution">
            <article className="problem-card">
              <p className="landing-card-kicker">The old way</p>
              <h3>Work without a clear view</h3>
              <ul>
                <li><span className="landing-x">×</span>Losing daily sheets in the poultry house</li>
                <li><span className="landing-x">×</span>Guessing whether a batch made a profit</li>
                <li><span className="landing-x">×</span>Selling during a medication withdrawal period</li>
                <li><span className="landing-x">×</span>Staff forgetting to record feed usage</li>
              </ul>
            </article>
            <article className="solution-card">
              <p className="landing-card-kicker">The FlockLedger way</p>
              <h3>One reliable farm record</h3>
              <ul>
                <li><span className="landing-check">✓</span>Attendants log data securely from their phones</li>
                <li><span className="landing-check">✓</span>Sales are blocked until withdrawal periods end</li>
                <li><span className="landing-check">✓</span>FCR, costs, and profit update automatically</li>
                <li><span className="landing-check">✓</span>Managers approve while owners see the big picture</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-tint" id="features">
        <div className="landing-container">
          <div className="landing-section-heading landing-section-heading-centered">
            <p className="landing-eyebrow">Built for every house, day, and batch</p>
            <h2>Everything you need to run a profitable poultry enterprise.</h2>
          </div>
          <div className="landing-feature-grid">
            {[
              ["01", "Flock Management", "Track daily mortality, culls, feed, and water. Auto-calculates live bird counts."],
              ["02", "Health & Safety", "Log vaccinations and treatments. Calculate exact safe-sale dates."],
              ["03", "Feed & Stock Control", "Manage deliveries, monitor stock levels, and receive reorder warnings."],
              ["04", "Profit & Loss", "Tag expenses to batches and know cost per kilogram and profit per bird."],
              ["05", "Weekly Weights", "Record sample weights and track uniformity to hit growth targets."],
              ["06", "Batch Closeout", "Generate a comprehensive one-page report at the end of every flock."],
            ].map(([number, title, copy]) => (
              <article className="landing-feature-card" key={title}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-container">
          <div className="landing-section-heading landing-section-heading-centered">
            <p className="landing-eyebrow">Trusted by modern farm managers</p>
            <h2>Clearer records lead to stronger decisions.</h2>
          </div>
          <div className="landing-testimonial-grid">
            <article>
              <p>“Before this, I was losing money on feed. Now, I know my exact FCR and cost per kg before I even sell.”</p>
              <strong>David <span>· Broiler Farmer</span></strong>
            </article>
            <article>
              <p>“The withdrawal period alerts alone have saved me from losing an entire batch. My vet loves the detailed health logs.”</p>
              <strong>Grace <span>· Farm Manager</span></strong>
            </article>
            <article>
              <p>“My attendants can record activity at the house, while I see the complete picture from anywhere.”</p>
              <strong>Samuel <span>· Poultry Business Owner</span></strong>
            </article>
          </div>
          <div className="landing-trust-badges">
            <span>✓ Data Hosted Securely on Supabase</span>
            <span>✓ Built for Mobile</span>
            <span>✓ Offline Mode Ready</span>
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-tint" id="how-it-works">
        <div className="landing-container">
          <div className="landing-section-heading landing-section-heading-centered">
            <p className="landing-eyebrow">How it works</p>
            <h2>From setup to daily records in three simple steps.</h2>
          </div>
          <div className="landing-step-grid">
            {[
              ["1", "Set up your farm", "Create an account, invite your staff, and assign owner, manager, attendant, veterinarian, or accountant roles."],
              ["2", "Add your batches", "Enter chicks received, feed targets, and the placement date for each flock."],
              ["3", "Record daily", "Attendants log house activity while managers and owners see the dashboard update."],
            ].map(([step, title, copy]) => (
              <article key={step}>
                <span>{step}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-cta">
        <LandingCta />
      </section>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-grid">
          <div className="landing-footer-brand">
            <Link className="landing-brand" href="/" aria-label="FlockLedger home">
              <span className="landing-brand-mark" aria-hidden="true">F</span>
              <span>FlockLedger</span>
            </Link>
            <p>Better poultry records. Better farm decisions.</p>
          </div>
          <div><strong>Product</strong><a href="#features">Features</a><Link href="/guides">Guides</Link></div>
          <div><strong>Company</strong><Link href="/about">About Us</Link><Link href="/contact">Contact</Link><Link href="/blog">Blog</Link></div>
          <div><strong>Legal</strong><Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms of Service</Link><Link href="/security">Data Security</Link></div>
          <div><strong>Contact</strong><a href="mailto:support@flockledger.co.ke">Support email</a><Link href="/contact">Contact us</Link></div>
        </div>
        <div className="landing-container landing-footer-bottom">© 2026 FlockLedger. All rights reserved.</div>
      </footer>
    </main>
    </LandingSessionProvider>
  );
}
