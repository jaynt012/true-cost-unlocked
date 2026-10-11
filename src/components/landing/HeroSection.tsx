import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import React, { useState } from "react";

export function HeroSection() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePosition({ x, y });

    const xPct = (x / rect.width - 0.5) * 2;
    const yPct = (y / rect.height - 0.5) * 2;
    
    const rotateY = xPct * 10; 
    const rotateX = yPct * 10;

    setTilt({ x: rotateX, y: rotateY });
  };

  return (
    <section className="relative px-4 sm:px-8 pt-12 pb-16 lg:pb-24">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Left: Hero text */}
        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 font-mono text-[11px] tracking-widest uppercase text-primary border border-primary/30 px-3 py-1.5 mb-8"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot" />
            ANALYSIS ENGINE V3
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="font-display leading-[0.9] mb-8"
          >
            <span className="block text-[clamp(3rem,8vw,7rem)] font-bold text-foreground tracking-tighter uppercase">
              HIDDEN FEES
            </span>
            <span className="block text-[clamp(3rem,8vw,7rem)] font-light italic text-foreground/60 tracking-tight">
              exposed.
            </span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="border-l-2 border-primary/40 pl-5 mb-10 max-w-md"
          >
            <p className="font-mono text-sm leading-relaxed text-muted-foreground">
              Decode complex financial agreements instantly. Detect manipulative clauses, calculate true repayment costs, and expose hidden fees with institutional-grade analysis.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="flex flex-wrap gap-4"
          >
            <Link
              to="/analyze"
              className="group inline-flex items-center gap-2 font-mono text-[12px] tracking-widest uppercase px-8 py-4 bg-primary text-primary-foreground hover:bg-primary/90 transition-all terminal-glow"
            >
              ANALYZE NOW
              <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </Link>
            <a
              href="#architecture"
              className="inline-flex items-center gap-2 font-mono text-[12px] tracking-widest uppercase px-8 py-4 text-primary border border-primary/30 hover:bg-primary/5 transition-all"
            >
              VIEW ARCHITECTURE
            </a>
          </motion.div>
        </div>

        {/* Right: Terminal dashboard */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <div
            className="terminal-card terminal-glow group relative overflow-hidden h-full"
            style={{ 
              transform: isHovering 
                ? `perspective(1000px) scale(0.96) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` 
                : 'perspective(1000px) scale(1) rotateX(0deg) rotateY(0deg)',
              transition: isHovering ? 'transform 0.1s ease-out' : 'transform 0.5s ease-out',
              transformStyle: 'preserve-3d'
            }}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => {
              setIsHovering(false);
              setTilt({ x: 0, y: 0 });
            }}
          >
          {/* Spotlight border effect */}
          {isHovering && (
            <div
              className="pointer-events-none absolute inset-0 z-50 rounded-[inherit] transition-opacity duration-300"
              style={{
                background: `radial-gradient(350px circle at ${mousePosition.x}px ${mousePosition.y}px, hsl(68 100% 45% / 0.9), transparent 40%)`,
                WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                WebkitMaskComposite: "xor",
                maskComposite: "exclude",
                padding: "2px",
              }}
            />
          )}
          {/* Terminal header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                ANALYSIS_ENGINE_V3
              </span>
              <span className="font-mono text-[10px] text-muted-foreground/50">Build: Tesseract Core</span>
            </div>
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 border border-muted-foreground/30" />
              <span className="w-2.5 h-2.5 border border-muted-foreground/30" />
              <span className="w-2.5 h-2.5 bg-primary" />
            </div>
          </div>

          {/* Dashboard content */}
          <div className="grid grid-cols-3 divide-x divide-border">
            {/* Chart area */}
            <div className="col-span-2 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  DOCUMENTS ANALYZED
                </span>
                <span className="font-mono text-sm font-bold text-primary">12,847</span>
              </div>
              <svg viewBox="0 0 400 120" className="w-full h-28">
                <polyline
                  points="0,100 40,85 80,90 120,60 160,70 200,40 240,55 280,25 320,35 360,15 400,10"
                  fill="none"
                  stroke="hsl(68, 100%, 45%)"
                  strokeWidth="2"
                />
                <polyline
                  points="0,100 40,85 80,90 120,60 160,70 200,40 240,55 280,25 320,35 360,15 400,10"
                  fill="url(#chartGrad)"
                  strokeWidth="0"
                />
                <defs>
                  <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(68, 100%, 45%)" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="hsl(68, 100%, 45%)" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="flex justify-between font-mono text-[9px] text-muted-foreground/50 mt-1">
                <span>T-00:15</span><span>T-00:10</span><span>T-00:05</span><span>NOW</span>
              </div>
            </div>

            {/* Stats sidebar */}
            <div className="divide-y divide-border">
              <div className="p-4">
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase block mb-2">
                  FEES DETECTED
                </span>
                <span className="font-display text-2xl font-bold text-foreground block">$2.4B</span>
                <span className="font-mono text-[10px] text-primary">Δ +18M (24H)</span>
              </div>
              <div className="p-4">
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase block mb-2">
                  RISK ALERTS
                </span>
                <span className="font-display text-xl font-bold text-foreground block">8,421</span>
                <div className="w-full h-1 bg-border mt-2">
                  <div className="h-full w-3/4 bg-primary" />
                </div>
              </div>
            </div>
          </div>

          {/* Execution log */}
          <div className="border-t border-border">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                ANALYSIS LOG
              </span>
              <span className="font-mono text-[10px] text-primary">LIVE...</span>
            </div>
            <div className="px-4 py-2 space-y-1 font-mono text-[11px]">
              {[
                { hash: "0x8f...4a", type: "FEE_DETECT", amount: "$2,450.00", status: "FLAGGED", color: "text-destructive" },
                { hash: "0x11...9c", type: "EMI_CALC", amount: "$847.21/mo", status: "COMPLETE", color: "text-primary" },
                { hash: "0x3b...2f", type: "RISK_SCAN", amount: "Score: 72", status: "WARNING", color: "text-yellow-500" },
                { hash: "0x7a...11", type: "CLAUSE_CHK", amount: "-", status: "OK", color: "text-primary" },
              ].map((log, i) => (
                <div key={i} className="flex items-center justify-between text-muted-foreground">
                  <span>
                    <span className="text-muted-foreground/50">[{log.hash}]</span>{" "}
                    {log.type}
                  </span>
                  <span className="flex items-center gap-6">
                    <span>{log.amount}</span>
                    <span className={`font-semibold ${log.color}`}>{log.status}</span>
                  </span>
                </div>
              ))}
            </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
