# Frontend Implementation Plan

## Design System and Branding

### Color Palette

- Primary: Deep Forest Green (`#15803d`) — agriculture, growth, and trust
- Secondary: Warm Amber/Yellow (`#f59e0b`) — poultry, energy, and action
- Background: Off-white/Slate (`#f8fafc`) — clean, readable UI
- Text: Dark Slate (`#0f172a`) — high-contrast readability

### Typography

Use Plus Jakarta Sans or Inter for clear, modern, highly legible typography.

### Imagery

Use high-quality photos of modern poultry houses together with clean UI mockups of FlockLedger on tablets and phones.

## Landing Page Structure

### 1. Sticky Navigation

**Left**

- FlockLedger logo
- Farm icon

**Center**

- Features
- Pricing
- Guides
- FAQ

**Right**

- Log In — ghost button
- Start Free Trial — amber primary button

The navigation should collapse into a mobile menu on small screens.

### 2. Hero Section

Use a subtle, blurred clean-poultry-house background with a gradient overlay.

**Headline**

> Stop guessing. Start tracking every bird, shilling, and bag of feed.

**Sub-headline**

> The reliable, digital record-keeping system built for commercial broiler and kienyeji farms. Replace lost paper logs, track health and withdrawal periods, and know your exact profit per batch.

**Primary CTA**

Create Your Free Farm Account

- No credit card required

**Secondary CTA**

See How It Works

- Links to a demo video or the How It Works section

**Visual**

- Angled dashboard mockup on a laptop
- Mobile phone mockup showing the Daily Entry Form
- Laptop and phone overlap the hero content visually

### 3. Problem vs. Solution

**Headline**

> Paper gets lost. Excel breaks. Your farm deserves better.

Use two columns.

**The Old Way**

- Losing daily sheets in the poultry house
- Guessing whether a batch made a profit
- Accidentally selling birds during a medication withdrawal period
- Staff forgetting to record feed usage

Grey these items out and use red or muted X icons.

**The New Way**

- Real-time entry: attendants log data securely from their phones
- Instant alerts: block sales until withdrawal periods end
- Live financials: FCR, costs, and profit update automatically
- Role-based access: managers approve and owners see the big picture

Use bright brand colors and green checkmarks.

### 4. Core Features Grid

**Headline**

> Everything you need to run a profitable poultry enterprise.

Create a responsive three-column-by-two-row feature grid.

**Flock Management**

- Track daily mortality, culls, feed, and water
- Auto-calculates live bird counts

**Health and Safety**

- Log vaccinations and treatments
- Calculate exact safe-sale dates

**Feed and Stock Control**

- Manage feed deliveries
- Monitor stock levels
- Show reorder warnings

**Profit and Loss**

- Tag expenses directly to batches
- Know exact cost per kilogram and profit per bird

**Weekly Weights**

- Record sample weights
- Track uniformity and growth targets

**Batch Closeout**

- Generate a comprehensive one-page report when a flock closes

### 5. Social Proof and Trust

**Headline**

> Trusted by modern farm managers.

Create three testimonial cards.

**Example 1**

> Before this, I was losing money on feed. Now, I know my exact FCR and cost per kg before I even sell.

— David, Broiler Farmer

**Example 2**

> The withdrawal period alerts alone have saved me from losing an entire batch. My vet loves the detailed health logs.

— Grace, Farm Manager

Add trust badges:

- Data Hosted Securely on Supabase
- Built for Mobile
- Offline Mode Ready

### 6. How It Works

Use three numbered steps.

**Step 1: Set Up Your Farm**

Create an account, add farm details, and configure the first workspace.

**Step 2: Add Your Batches**

Enter chicks received, feed targets, house details, and placement date.

**Step 3: Record Daily**

Attendants log data from the house while managers and owners see live dashboard updates.

### 7. Call to Action Banner

Use a Deep Forest Green background.

**Headline**

> Your birds are growing. Your records should be too.

**Button**

Start Your First Batch Today

Use the amber CTA style.

### 8. Footer

Use grouped columns.

**Product**

- Features
- Pricing
- Guides

**Company**

- About Us
- Contact
- Blog

**Legal**

- Privacy Policy
- Terms of Service
- Data Security

**Contact**

- Support email
- WhatsApp number

**Bottom**

> © 2026 FlockLedger. All rights reserved.

## Public and Authenticated Routing

Recommended routes:

- `/` — Marketing landing page
- `/login` — Account sign-in
- `/signup` — Account and farm-owner registration
- `/app` — Existing authenticated application
- `/app/onboarding/farm` — First-farm setup
- `/app/onboarding/team` — Invite initial staff
- `/app/settings/team` — Later team management

The existing authenticated application can remain unchanged initially. Keep it separate from the public marketing route.

## Account and Farm Onboarding

All users use the same sign-up and sign-in forms regardless of role.

After an owner creates an account:

1. Confirm account status based on the Supabase email-confirmation setting.
2. Sign the owner in.
3. Create the owner's first farm.
4. Assign the creator the `owner` role automatically.
5. Optionally create the first batch.
6. Add invited staff to the farm.
7. Enter the app dashboard.

Only users with the `owner` role may create a farm. Creating a farm automatically makes the creator its owner.

Allow users to skip first-batch creation and staff setup. Account and farm setup should be usable before the farm starts production.

## Staff and Role Management

Build team management on top of the existing farm-members API.

### Required Staff Actions

- List farm members
- Invite users by email
- Assign roles
- Update an existing member’s role
- Remove a member
- Show pending or failed invitations
- Prevent removal or demotion of the final owner
- Hide or disable actions unavailable to the current role

### Supported Roles

- Owner
- Manager
- Attendant — used for workers
- Veterinarian
- Accountant

Do not introduce a separate `worker` database role. Worker-facing labels and descriptions should use the existing `attendant` role.

Only the owner may invite or add staff, assign or change roles, and remove members. Managers and all other roles cannot access these controls.

The role names and permissions should match the existing backend implementation and database RLS policies:

- Owners can manage farms and members.
- Managers can manage batches and operational records.
- Attendants can record daily, weight, feed, and stock activity.
- Veterinarians can add health records.
- Accountants can add sales and cash entries.

## Components

Create components with this structure:

- `src/components/landing/Navigation.tsx`
- `src/components/landing/Hero.tsx`
- `src/components/landing/ProblemSolution.tsx`
- `src/components/landing/Features.tsx`
- `src/components/landing/Testimonials.tsx`
- `src/components/landing/HowItWorks.tsx`
- `src/components/landing/CtaBanner.tsx`
- `src/components/landing/Footer.tsx`
- `src/components/onboarding/FarmSetup.tsx`
- `src/components/onboarding/TeamSetup.tsx`
- `src/components/team/TeamManagement.tsx`

Keep shared buttons, notices, dialogs, inputs, and layout primitives in a small `src/components/ui/` folder.

## Responsive and Accessibility Requirements

- Support desktop, tablet, and mobile layouts.
- Use semantic headings and landmark elements.
- Keep keyboard focus visible.
- Preserve sufficient color contrast.
- Provide accessible names for icon-only controls.
- Use clear form labels and inline validation.
- Include loading, empty, success, pending, and error states.
- Avoid layout shifts in landing-page mockups and farm onboarding.

## Implementation Order

1. Extract reusable landing-page components.
2. Implement the public landing page at `/`.
3. Add `/login` and `/signup` routes.
4. Connect landing-page CTAs to account registration and sign-in.
5. Separate public marketing content from the authenticated app component.
6. Add first-farm onboarding.
7. Add the team invitation and role-management screen.
8. Connect team management to `/api/farms/:farmId/members`.
9. Add loading, empty, success, pending, and error states.
10. Verify responsive behavior and keyboard navigation.
11. Run lint, tests, and the production build.

## Existing Backend Surfaces

The existing application has:

- Email sign-up and sign-in API routes
- Multi-farm account support
- Farm-scoped member management
- Owners, managers, attendants, veterinarians, and accountants
- Supabase session authentication
- PostgreSQL Row Level Security
- Batch, flock, health, feed, stock, sales, labour, and financial endpoints

Frontend work should reuse these existing APIs and preserve backend role and farm-scoping rules. It should not move authorization decisions exclusively into the client.
