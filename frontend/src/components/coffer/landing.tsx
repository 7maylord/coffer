"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon, Mark, type IconName } from "./icon";
import { KineticVault, MotionObserver } from "./kinetic";
const chapters: {
  number: string;
  title: string;
  text: string;
  icon: IconName;
  route: string;
}[] = [
  {
    number: "01",
    title: "A place for your money.",
    text: "See the whole picture. Allocate with intention. Give every part of your business room to grow.",
    icon: "treasury",
    route: "treasury",
  },
  {
    number: "02",
    title: "A little more autonomy.",
    text: "Let agents handle the small things, with clear budgets, trusted services, and you in control.",
    icon: "agents",
    route: "agents",
  },
  {
    number: "03",
    title: "A lot more peace of mind.",
    text: "Human approvals, thoughtful permissions, and a trail you can follow. Confidence is designed in.",
    icon: "shield",
    route: "approvals",
  },
];
export function Landing() {
  const [menu, setMenu] = useState(false);
  return (
    <div className="landing">
      <MotionObserver />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="landing-nav">
        <Link className="brand" href="/" aria-label="Coffer home">
          <Mark />
          coffer<span className="brand-period">.</span>
        </Link>
        <nav
          className={menu ? "landing-links open" : "landing-links"}
          aria-label="Main navigation"
        >
          <a href="#possibilities" onClick={() => setMenu(false)}>
            The possibilities
          </a>
          <a href="#principles" onClick={() => setMenu(false)}>
            Our approach
          </a>
          <Link href="/demo/overview">
            Explore a workspace <Icon name="northeast" size={15} />
          </Link>
        </nav>
        <Link href="/overview" className="button dark nav-cta">
          Sign in <Icon name="arrow" size={17} />
        </Link>
        <button
          className="icon-button mobile-toggle"
          aria-label="Toggle navigation"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Icon name={menu ? "close" : "menu"} />
        </button>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="landing-hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" />A NEW WAY TO WORK WITH MONEY
            </div>
            <h1>
              Money,
              <br />
              with <em>intention.</em>
              <span className="hero-asterisk">✳</span>
            </h1>
            <p>
              Your treasury, your people, your next big idea.
              <br className="desktop-break" /> Finally, a little more in sync.
            </p>
            <Link className="button dark large" href="/demo/overview">
              Find your flow <Icon name="northeast" />
            </Link>
            <div className="hero-footnote">
              <span className="tiny-symbol">↳</span> An interactive sample. Room
              to explore.
            </div>
          </div>
          <KineticVault />
        </section>
        <div className="landing-ribbon">
          <span>LESS FRICTION.</span>
          <span className="ribbon-star">✳</span>
          <span>MORE POSSIBILITY.</span>
          <span className="ribbon-star">✳</span>
          <span>ALWAYS YOUR CALL.</span>
          <span className="ribbon-star">✳</span>
          <span>BUILT ON NEAR.</span>
        </div>
        <section className="possibilities section-wrap" id="possibilities">
          <div className="section-intro" data-reveal>
            <span className="eyebrow">A CALMER KIND OF CONTROL</span>
            <h2>
              Great work needs
              <br />
              <em>space to happen.</em>
            </h2>
            <p>
              Less tab-hopping. Fewer loose ends.
              <br />
              One considered home for your business finances.
            </p>
          </div>
          <div className="chapter-grid">
            {chapters.map((chapter) => (
              <Link
                href={`/demo/${chapter.route}`}
                className="chapter-card"
                key={chapter.number}
                data-reveal
              >
                <div className="chapter-top">
                  <span>{chapter.number} /</span>
                  <Icon name="northeast" />
                </div>
                <div className={`chapter-art art-${chapter.number}`}>
                  <Icon name={chapter.icon} size={58} />
                  <i />
                  <i />
                </div>
                <h3>{chapter.title}</h3>
                <p>{chapter.text}</p>
                <span className="text-link">
                  Take a closer look <Icon name="arrow" size={17} />
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section className="manifesto" id="principles">
          <div className="manifesto-inner" data-reveal>
            <div>
              <span className="eyebrow">AUTONOMY, WITH A HUMAN CENTER</span>
              <h2>
                Move forward.
                <br />
                <em>Stay in the loop.</em>
              </h2>
            </div>
            <div className="principle-list">
              <div>
                <span>01</span>
                <h3>AI suggests. You decide.</h3>
                <p>
                  Ideas become proposals. Proposals get reviewed. Your money
                  always has a human boundary.
                </p>
              </div>
              <div>
                <span>02</span>
                <h3>Clarity is a feature.</h3>
                <p>
                  Know what is simulated, what is awaiting approval, and what
                  has actually settled.
                </p>
              </div>
              <div>
                <span>03</span>
                <h3>Trust is in the details.</h3>
                <p>
                  Exact amounts, explicit permissions, and evidence behind every
                  financial state.
                </p>
              </div>
            </div>
          </div>
        </section>
        <section className="landing-invitation section-wrap" data-reveal>
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h2>
            A good place
            <br />
            to <em>begin.</em>
          </h2>
          <Link
            className="round-cta"
            href="/demo/overview"
            aria-label="Enter the sample workspace"
          >
            <Icon name="northeast" size={44} />
          </Link>
          <p>
            A fictional studio. A real feel for what comes next.
            <br />
            Explore with synthetic data. No wallet needed.
          </p>
        </section>
      </main>
      <footer className="landing-footer">
        <Link href="/" className="brand">
          <Mark small />
          coffer.
        </Link>
        <span>Considered money. Collective possibility.</span>
        <Link href="/demo/settings">
          Sample & privacy notes <Icon name="northeast" size={14} />
        </Link>
        <span>© 2026 Coffer</span>
      </footer>
    </div>
  );
}
