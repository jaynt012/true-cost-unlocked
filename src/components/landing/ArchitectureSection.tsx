import { motion } from "framer-motion";
import { FileSearch, Shield, Calculator, Brain } from "lucide-react";
import React, { useState } from "react";

const modules = [
  {
    id: "SYS.01",
    icon: FileSearch,
    title: "Document Decoder",
    desc: "Converts complex financial and legal text into plain English. Identifies key terms, obligations, and conditions automatically.",
  },
  {
    id: "SYS.02",
    icon: Shield,
    title: "Fee & Risk Scanner",
    desc: "Detects hidden fees, penalty clauses, and manipulative language patterns. Assigns a risk score based on 40+ financial red flags.",
  },
  {
    id: "SYS.03",
    icon: Calculator,
    title: "Precision Calculator",
    desc: "Computes EMI, total repayment, and interest using exact formulas. Shows the true cost gap between advertised and actual rates.",
  },
  {
    id: "SYS.04",
    icon: Brain,
    title: "AI Insights Engine",
    desc: "Provides optional AI-enhanced recommendations while deterministic local analysis remains the default reliability layer.",
    hasApiTag: true,
  },
];

function ModuleCard({ mod, i }: { mod: any; i: number }) {
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
      className="bg-background p-8 group relative overflow-hidden transition-colors hover:bg-card/50"
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
      {mod.hasApiTag && (
        <div className="absolute top-6 right-6 font-mono text-[10px] text-muted-foreground space-y-1 z-10">
          <div className="text-primary/60">AI MODE </div>
          <div className="text-primary/40">Pro Exclusive</div>
        </div>
      )}
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

export function ArchitectureSection() {
  return (
    <section id="architecture" className="px-4 sm:px-8 py-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="mb-12"
      >
        <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground mb-2">
          Core Architecture
        </h2>
        <p className="font-mono text-[11px] tracking-widest text-primary uppercase">
          MODULAR. TRANSPARENT.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
        {modules.map((mod, i) => (
          <ModuleCard key={mod.id} mod={mod} i={i} />
        ))}
      </div>
    </section>
  );
}
