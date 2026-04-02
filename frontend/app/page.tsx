"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const DISHES = [
  "Spaghetti Carbonara",
  "Beef Wellington",
  "Tom Kha Gai",
  "Homemade Croissants",
  "Mole Negro",
  "Pad Thai",
  "Bouillabaisse",
  "Chicken Tikka Masala",
  "Peking Duck",
  "Bibimbap",
  "Ceviche",
  "Tagine",
  "Moussaka",
  "Shoyu Ramen",
  "Osso Buco",
  "Shakshuka",
  "Boeuf Bourguignon",
  "Lobster Bisque",
  "Arepas con Queso",
  "Baklava",
  "Risotto al Barolo",
];

const TICKER_ITEMS = [...DISHES, ...DISHES];

const FEATURES = [
  {
    icon: "🧠",
    label: "Remembers everything",
    title: "Your kitchen, in context",
    body: "Learns your cookware, dietary restrictions, flavor profile, and past conversations.",
    accent: "accent",
  },
  {
    icon: "🍳",
    label: "Cookware-aware",
    title: "Recipes you can actually make",
    body: "Tell it what you own — wok, Dutch oven, instant pot — and it adapts every recipe to your setup.",
    accent: "olive",
  },
  {
    icon: "📖",
    label: "Cook mode",
    title: "A sous chef for every step",
    body: "Hands-free step-by-step guidance with built-in timers. Never lose your place in a recipe again.",
    accent: "gold",
  },
  {
    icon: "💾",
    label: "Save & organize",
    title: "Your personal recipe collection",
    body: "One tap saves any recipe. Build a collection that grows with every conversation.",
    accent: "accent",
  },
];

const HOW_STEPS = [
  {
    num: "01",
    title: "Ask anything",
    body: "Type a question, a craving, or a technique. No special formatting needed — just talk.",
  },
  {
    num: "02",
    title: "Get a tailored recipe",
    body: "The AI checks your cookware and pantry, then crafts a recipe designed for your kitchen.",
  },
  {
    num: "03",
    title: "Cook step by step",
    body: "Activate Cook Mode for hands-free guidance with timers built into every step.",
  },
];

function getTickerColor(index: number): string {
  const mod = index % 3;
  if (mod === 0) return "var(--accent)";
  if (mod === 1) return "var(--olive)";
  return "var(--text-muted)";
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 20);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", overflowX: "hidden" }}>

      {/* Sticky Nav */}
      <nav style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        padding: "0 40px",
        height: "64px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        transition: "background 0.25s ease, backdrop-filter 0.25s ease, box-shadow 0.25s ease",
        background: scrolled ? "rgba(250,248,244,0.88)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(12px)" : "none",
        boxShadow: scrolled ? "0 1px 0 var(--border)" : "none",
      }}>
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "1.4rem" }}>🍳</span>
          <span className="font-serif" style={{ fontSize: "1.15rem", fontStyle: "italic", color: "var(--text)" }}>
            Mise en Place
          </span>
        </Link>

        <div className="landing-nav-links" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Link href="/login" className="btn btn-ghost btn-sm" style={{ color: "var(--text-muted)" }}>
            Sign in
          </Link>
          <Link
            href="/signup"
            className="btn btn-primary btn-sm"
            style={{ borderRadius: "99px", padding: "8px 20px" }}
          >
            Start cooking →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        padding: "100px 40px 60px",
        textAlign: "center",
        maxWidth: "800px",
        margin: "0 auto",
      }}>
        <div
          className="animate-fade-up"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "var(--accent-light)",
            color: "var(--accent)",
            borderRadius: "99px",
            padding: "5px 14px",
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: "28px",
          }}
        >
          AI Cooking Assistant
        </div>

        <h1
          className="font-serif animate-fade-up"
          style={{
            fontSize: "clamp(2.8rem, 6vw, 4.5rem)",
            fontStyle: "italic",
            lineHeight: 1.1,
            color: "var(--text)",
            margin: "0 0 24px",
            animationDelay: "0.05s",
          }}
        >
          The AI that belongs<br />in your kitchen.
        </h1>

        <p
          className="animate-fade-up"
          style={{
            fontSize: "1.1rem",
            color: "var(--text-muted)",
            lineHeight: 1.7,
            margin: "0 0 40px",
            maxWidth: "560px",
            marginLeft: "auto",
            marginRight: "auto",
            animationDelay: "0.1s",
          }}
        >
          Ask any recipe question. Get beautifully formatted guides tailored to your cookware, pantry, and skill level.
        </p>

        <div className="animate-fade-up" style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", animationDelay: "0.15s" }}>
          <Link
            href="/signup"
            className="btn btn-primary btn-lg"
            style={{ borderRadius: "99px" }}
          >
            Start cooking — it's free
          </Link>
          <Link
            href="/login"
            className="btn btn-secondary btn-lg"
            style={{ borderRadius: "99px" }}
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Ticker */}
      <div style={{
        overflow: "hidden",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        padding: "16px 0",
        background: "var(--bg-card)",
        marginBottom: "80px",
      }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0",
            whiteSpace: "nowrap",
            animation: "marquee 35s linear infinite",
            width: "max-content",
          }}
        >
          {TICKER_ITEMS.map((dish, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0" }}>
              <span
                style={{
                  fontSize: "0.9375rem",
                  fontWeight: 500,
                  color: getTickerColor(i),
                  padding: "0 20px",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {dish}
              </span>
              <span style={{ color: "var(--border-strong)", fontSize: "0.5rem" }}>●</span>
            </span>
          ))}
        </div>
      </div>

      {/* Chat Preview Mockup */}
      <section style={{
        maxWidth: "920px",
        margin: "0 auto 100px",
        padding: "0 40px",
      }}>
        <div style={{ textAlign: "center", marginBottom: "48px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "var(--olive-light)",
              color: "var(--olive)",
              borderRadius: "99px",
              padding: "5px 14px",
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: "16px",
            }}
          >
            See it in action
          </div>
          <h2
            className="font-serif"
            style={{
              fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
              fontStyle: "italic",
              color: "var(--text)",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            From question to kitchen.
          </h2>
        </div>

        {/* Mock app window */}
        <div
          style={{
            borderRadius: "20px",
            overflow: "hidden",
            boxShadow: "0 24px 80px rgba(28,22,18,0.14)",
            border: "1px solid var(--border)",
          }}
        >
          {/* Window chrome */}
          <div style={{
            background: "var(--bg-card)",
            borderBottom: "1px solid var(--border)",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ display: "flex", gap: "6px" }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF5F57" }} />
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FEBC2E" }} />
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28C840" }} />
              </div>
              <span className="font-serif" style={{ fontSize: "0.9rem", fontStyle: "italic", color: "var(--text-muted)", marginLeft: "8px" }}>
                Mise en Place
              </span>
            </div>
            <span className="badge badge-olive" style={{ fontSize: "0.7rem" }}>
              Dutch Oven · Cast Iron
            </span>
          </div>

          {/* Chat content */}
          <div style={{ background: "var(--bg)", padding: "28px 28px 24px" }}>
            {/* User bubble */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "24px" }}>
              <div style={{
                background: "var(--text)",
                color: "var(--bg)",
                borderRadius: "20px 20px 4px 20px",
                padding: "11px 18px",
                maxWidth: "60%",
                fontSize: "0.9375rem",
                lineHeight: 1.6,
                boxShadow: "var(--shadow-sm)",
              }}>
                How do I make boeuf bourguignon?
              </div>
            </div>

            {/* AI response */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              <div style={{
                fontSize: "0.65rem",
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--accent)",
                marginBottom: "10px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
                Mise en Place
              </div>

              <div style={{ width: "100%", maxWidth: "640px" }}>
                <div className="font-serif" style={{ fontSize: "1.2rem", fontStyle: "italic", color: "var(--text)", marginBottom: "16px" }}>
                  Boeuf Bourguignon
                </div>

                {/* Section header */}
                <div style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "1rem",
                  fontStyle: "italic",
                  color: "var(--accent)",
                  paddingLeft: "12px",
                  position: "relative",
                  marginBottom: "10px",
                  lineHeight: 1.3,
                }}>
                  <div style={{ position: "absolute", left: 0, top: "0.1em", bottom: "0.1em", width: "3px", background: "var(--accent)", borderRadius: "2px" }} />
                  Ingredients
                </div>

                {/* Ingredient list */}
                <div style={{ border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden", marginBottom: "16px" }}>
                  {[
                    "1.5 kg beef chuck, cut into 5cm cubes",
                    "750ml Burgundy red wine",
                    "200g lardons or thick-cut bacon",
                    "300g pearl onions, peeled",
                    "300g cremini mushrooms, quartered",
                    "3 cloves garlic, minced",
                  ].map((ing, i) => (
                    <div key={i} style={{
                      padding: "7px 12px 7px 30px",
                      borderBottom: i < 5 ? "1px solid var(--border)" : "none",
                      fontSize: "0.9rem",
                      lineHeight: 1.55,
                      background: i % 2 === 1 ? "var(--bg-subtle)" : "transparent",
                      position: "relative",
                    }}>
                      <span style={{
                        position: "absolute",
                        left: "11px",
                        top: "14px",
                        width: "6px",
                        height: "6px",
                        background: "var(--accent)",
                        borderRadius: "50%",
                        opacity: 0.7,
                        display: "inline-block",
                      }} />
                      {ing}
                    </div>
                  ))}
                </div>

                {/* Section header */}
                <div style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "1rem",
                  fontStyle: "italic",
                  color: "var(--accent)",
                  paddingLeft: "12px",
                  position: "relative",
                  marginBottom: "10px",
                  lineHeight: 1.3,
                }}>
                  <div style={{ position: "absolute", left: 0, top: "0.1em", bottom: "0.1em", width: "3px", background: "var(--accent)", borderRadius: "2px" }} />
                  Method
                </div>

                {/* Steps */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
                  {[
                    "Pat beef dry. Season with salt and pepper. Sear in batches in your Dutch oven until deeply browned on all sides.",
                    "Remove beef. Cook lardons until crisp. Add onions and cook 5 minutes. Add garlic, cook 1 minute more.",
                    "Deglaze with wine, scraping up all browned bits. Return beef. Add stock to just cover.",
                    "Braise at 160°C (320°F) for 2.5–3 hours until beef is fork-tender.",
                  ].map((step, i) => (
                    <div key={i} style={{
                      position: "relative",
                      padding: "10px 14px 10px 48px",
                      background: "var(--bg-subtle)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      lineHeight: 1.65,
                      fontSize: "0.9rem",
                    }}>
                      <span style={{
                        position: "absolute",
                        left: "12px",
                        top: "11px",
                        width: "22px",
                        height: "22px",
                        background: "var(--accent)",
                        color: "#fff",
                        borderRadius: "50%",
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}>
                        {i + 1}
                      </span>
                      {step}
                    </div>
                  ))}
                </div>

                {/* Badges */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span className="badge badge-olive">Dutch Oven</span>
                  <span className="badge badge-neutral">recipe</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section style={{ background: "var(--bg-subtle)", padding: "80px 40px" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "56px" }}>
            <h2
              className="font-serif"
              style={{
                fontSize: "clamp(1.8rem, 4vw, 2.4rem)",
                fontStyle: "italic",
                color: "var(--text)",
                margin: "0 0 12px",
              }}
            >
              Everything your kitchen needs.
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "1rem", margin: 0 }}>
              Built for real cooks, not recipe bots.
            </p>
          </div>

          <div
            className="landing-features-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "20px",
            }}
          >
            {FEATURES.map((f, i) => (
              <div
                key={i}
                onMouseEnter={() => setHoveredFeature(i)}
                onMouseLeave={() => setHoveredFeature(null)}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: "16px",
                  padding: "28px 24px",
                  cursor: "default",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                  transform: hoveredFeature === i ? "translateY(-3px)" : "translateY(0)",
                  boxShadow: hoveredFeature === i ? "0 12px 32px rgba(28,22,18,0.12)" : "var(--shadow-sm)",
                }}
              >
                <div style={{ fontSize: "1.8rem", marginBottom: "12px" }}>{f.icon}</div>
                <div style={{
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: f.accent === "olive" ? "var(--olive)" : f.accent === "gold" ? "var(--gold)" : "var(--accent)",
                  marginBottom: "8px",
                }}>
                  {f.label}
                </div>
                <h3 className="font-serif" style={{
                  fontSize: "1.1rem",
                  fontStyle: "italic",
                  color: "var(--text)",
                  margin: "0 0 10px",
                  lineHeight: 1.3,
                }}>
                  {f.title}
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0, lineHeight: 1.65 }}>
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section style={{ background: "var(--bg-card)", padding: "80px 40px" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "56px" }}>
            <h2
              className="font-serif"
              style={{
                fontSize: "clamp(1.8rem, 4vw, 2.4rem)",
                fontStyle: "italic",
                color: "var(--text)",
                margin: "0 0 12px",
              }}
            >
              Simple as boiling water.
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "1rem", margin: 0 }}>
              Three steps from question to plated dish.
            </p>
          </div>

          <div
            className="landing-how-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "48px",
            }}
          >
            {HOW_STEPS.map((step, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div
                  className="font-serif"
                  style={{
                    fontSize: "5rem",
                    fontStyle: "italic",
                    color: "var(--border-strong)",
                    lineHeight: 1,
                    marginBottom: "20px",
                  }}
                >
                  {step.num}
                </div>
                <h3
                  className="font-serif"
                  style={{
                    fontSize: "1.2rem",
                    fontStyle: "italic",
                    color: "var(--text)",
                    margin: "0 0 10px",
                  }}
                >
                  {step.title}
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9375rem", margin: 0, lineHeight: 1.65 }}>
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section style={{
        background: "var(--text)",
        padding: "80px 40px",
        textAlign: "center",
      }}>
        <div style={{ maxWidth: "600px", margin: "0 auto" }}>
          <h2
            className="font-serif"
            style={{
              fontSize: "clamp(2rem, 5vw, 3rem)",
              fontStyle: "italic",
              color: "var(--bg)",
              margin: "0 0 16px",
              lineHeight: 1.15,
            }}
          >
            Ready to mise en place?
          </h2>
          <p style={{
            color: "rgba(240,235,228,0.55)",
            fontSize: "1rem",
            margin: "0 0 36px",
            lineHeight: 1.7,
          }}>
            Join cooks who never stare at a blank recipe page again. Free to start, no credit card needed.
          </p>
          <Link
            href="/signup"
            className="btn btn-primary btn-lg"
            style={{ borderRadius: "99px", padding: "16px 36px", fontSize: "1rem" }}
          >
            Start cooking free →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        background: "var(--bg-card)",
        borderTop: "1px solid var(--border)",
        padding: "28px 40px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "1.2rem" }}>🍳</span>
          <span className="font-serif" style={{ fontSize: "1rem", fontStyle: "italic", color: "var(--text)" }}>
            Mise en Place
          </span>
        </div>
        <p style={{ color: "var(--text-faint)", fontSize: "0.875rem", margin: 0 }}>
          Your kitchen, intelligently organized.
        </p>
      </footer>

    </div>
  );
}
