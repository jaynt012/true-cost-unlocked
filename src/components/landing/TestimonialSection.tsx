import { motion } from "framer-motion";
import React, { useState, useRef } from "react";

export function TestimonialSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    containerRef.current.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    containerRef.current.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  };

  return (
    <section className="px-4 sm:px-8 py-20 relative">
      <div 
        ref={containerRef}
        className="max-w-3xl mx-auto relative group"
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Ambient background light behind the component (reduced to 168px) */}
        <div 
          className="pointer-events-none absolute -inset-6 transition-opacity duration-200 blur-2xl -z-10 rounded-2xl will-change-transform"
          style={{
            opacity: isHovering ? 1 : 0,
            background: `radial-gradient(168px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), hsl(68 100% 45% / 0.45), transparent 70%)`
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="terminal-card bg-card pt-12 pb-8 sm:pt-14 sm:pb-12 px-8 sm:px-12 text-center relative z-10 overflow-hidden"
        >
          {/* Subtle 20% light effect on top of component */}
          <div 
            className="pointer-events-none absolute inset-0 transition-opacity duration-200 z-10 will-change-transform"
            style={{
              opacity: isHovering ? 0.2 : 0,
              background: `radial-gradient(168px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), hsl(68 100% 45% / 0.5), transparent 70%)`
            }}
          />

          <div className="absolute top-4 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-widest uppercase text-primary/50 z-10 whitespace-nowrap">
            TRANSMISSION INTERCEPTED
          </div>
          
          <blockquote className="font-display text-xl sm:text-2xl font-bold text-foreground leading-relaxed mb-6 relative z-10">
            "TRUE COST saved us from a loan agreement with $12,000 in hidden fees we never would have caught. 
            The risk analysis was eye-opening."
          </blockquote>
          <div className="space-y-1 relative z-10">
            <p className="font-mono text-sm text-muted-foreground">Financial Advisor</p>
            <p className="font-mono text-[11px] text-primary/60">Independent Consumer Advocacy Group</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
