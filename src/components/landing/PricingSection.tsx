import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check } from "lucide-react";

const tiers = [
  {
    label: "FREE",
    title: "Analyzer",
    price: "Free",
    badge: null,
    note: null,
    features: ["Document Analysis", "EMI Calculator", "Basic Risk Score"],
    cta: "Start Analyzing",
    ctaLink: "/analyze",
    highlight: false,
  },
  {
    label: "STANDARD",
    title: "AI Enhanced",
    price: "Pro",
    badge: "FREE ACCESS",
    note: "Limited-time free access — all features unlocked.",
    features: ["Everything in Free", "AI-Powered Insights", "Deep Fee Detection", "Comparison Reports"],
    cta: "Access Free Pro",
    ctaLink: "/analyze",
    highlight: true,
  },
  {
    label: "ENTERPRISE",
    title: "White-Label",
    price: "Custom",
    badge: null,
    note: null,
    features: ["Full API Access", "Custom Integrations", "Bulk Processing", "On-premise Deployment"],
    cta: "Contact Us",
    ctaLink: "/contact",
    highlight: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="px-4 sm:px-8 py-20">
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground mb-2"
      >
        Access Tiers
      </motion.h2>
      <p className="font-mono text-[11px] tracking-widest text-primary uppercase mb-12">TRANSPARENT PRICING</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
        {tiers.map((tier, i) => (
          <motion.div
            key={tier.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className={`p-8 flex flex-col justify-between ${
              tier.highlight ? "bg-card terminal-border-glow border-l border-r border-primary/20" : "bg-background"
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-[10px] tracking-widest text-primary/60">{tier.label}</span>
                {tier.badge && (
                  <span className="font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 border border-primary/40 text-primary bg-primary/5">
                    {tier.badge}
                  </span>
                )}
              </div>
              <h3 className="font-display text-xl font-bold text-foreground mb-1">{tier.title}</h3>
              <span className="font-display text-3xl font-bold text-primary block mb-2">{tier.price}</span>
              {tier.note && (
                <p className="font-mono text-[11px] text-primary/90 mb-4">{tier.note}</p>
              )}

              <ul className="space-y-3 mb-8">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <Link
              to={tier.ctaLink}
              className={`block text-center font-mono text-[11px] tracking-widest uppercase py-3 transition-all ${
                tier.highlight
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 terminal-glow"
                  : "border border-border text-foreground hover:border-primary/30 hover:text-primary"
              }`}
            >
              {tier.cta}
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
