import { motion } from "framer-motion";
import React, { useState } from "react";

const problems = [
  { code: "ERR_01", title: "Hidden Fee Structures", desc: "Buried in pages of legal text, fees silently inflate your true cost by 15-40%." },
  { code: "ERR_02", title: "Manipulative Clauses", desc: "Penalty APRs, indefinite terms, and unilateral change clauses trap borrowers." },
  { code: "ERR_03", title: "Opaque Calculations", desc: "Complex interest compounding obscures the real repayment amount you'll pay." },
];

function ProblemCard({ p, i }: { p: any; i: number }) {
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
          background: `radial-gradient(200px circle at ${mousePos.x}px ${mousePos.y}px, hsl(var(--destructive) / 0.25), transparent 60%)`
        }}
      />
      <span className="font-mono text-[11px] tracking-widest text-destructive mb-4 block relative z-10">{p.code}</span>
      <h3 className="font-display text-lg font-bold text-foreground mb-3 relative z-10">{p.title}</h3>
      <p className="font-mono text-sm text-muted-foreground leading-relaxed relative z-10">{p.desc}</p>
    </motion.div>
  );
}

export function ProblemSection() {
  return (
    <section id="features" className="px-4 sm:px-8 py-20">
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground max-w-3xl leading-tight mb-12"
      >
        Financial agreements hide{" "}
        <span className="text-primary">billions in fees</span> behind complex language.
        We decode every clause.
      </motion.h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
        {problems.map((p, i) => (
          <ProblemCard key={p.code} p={p} i={i} />
        ))}
      </div>
    </section>
  );
}
