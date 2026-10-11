import { motion } from "framer-motion";
import { Mail, BookOpen, AlertTriangle, Globe } from "lucide-react";
import React, { useState } from "react";

const features = [
  {
    id: "AI.01",
    icon: Mail,
    title: "AI Counter-Offer Email",
    desc: "Don't accept the first offer. The AI automatically drafts a polite, professional, and firm counter-offer email based on the hidden fees and predatory terms it detects in the contract, ready to send with one click.",
  },
  {
    id: "AI.02",
    icon: AlertTriangle,
    title: "Legal Loopholes & Traps",
    desc: "The AI dives deep into the legal jargon to find clauses that give the lender an unfair advantage. It translates terms like 'Rule of 78s' or 'Factor Rates' into plain English warnings.",
  },
  {
    id: "AI.03",
    icon: BookOpen,
    title: "Negotiation Playbook",
    desc: "Get tactical, step-by-step strategies to negotiate your specific contract. The AI tells you exactly what to say to waive origination fees or lower the interest rate.",
  },
  {
    id: "AI.04",
    icon: Globe,
    title: "Global Currency Support",
    desc: "Whether your contract is in Dollars ($), Euros (€), or Rupees (₹), the analyzer automatically detects it and formats all calculations, UI charts, and AI summaries in your local currency.",
  },
];

function FeatureCard({ mod, i }: { mod: any; i: number }) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: i * 0.1 }}
      className="bg-background p-8 group relative overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Decorative spotlight on hover */}
      <div 
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: isHovering ? 1 : 0,
          background: `radial-gradient(200px circle at ${mousePos.x}px ${mousePos.y}px, hsl(68 100% 45% / 0.25), transparent 60%)`
        }}
      />
      
      <span className="font-mono text-[10px] tracking-widest text-primary/60 mb-6 block relative z-10">{mod.id}</span>
      <div className="flex items-start gap-4 relative z-10">
        <mod.icon className="w-6 h-6 text-primary flex-shrink-0 mt-1" strokeWidth={1.5} />
        <div>
          <h3 className="font-display text-lg font-bold text-foreground mb-2">{mod.title}</h3>
          <p className="font-mono text-sm text-muted-foreground leading-relaxed">{mod.desc}</p>
        </div>
      </div>
    </motion.div>
  );
}

export function AIFeaturesSection() {
  return (
    <section id="ai-features" className="px-4 sm:px-8 py-20 bg-background/50 relative border-t border-b border-border/50">
      <div className="absolute inset-0 scanline opacity-20 pointer-events-none" />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="mb-12 relative z-10"
      >
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground">
            Next-Gen AI Intelligence
          </h2>
          <span className="bg-primary/20 text-primary font-mono text-[10px] px-2 py-0.5 rounded border border-primary/30 ml-2 animate-pulse">
            NEW
          </span>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border relative z-10">
        {features.map((mod, i) => (
          <FeatureCard key={mod.id} mod={mod} i={i} />
        ))}
      </div>
    </section>
  );
}
