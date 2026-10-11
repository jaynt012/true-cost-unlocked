import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import React, { useState, useEffect } from "react";

function useRandomizedNumber(target: string, duration = 1500, delay = 200) {
  const [display, setDisplay] = useState(() =>
    target.replace(/[0-9]/g, () => Math.floor(Math.random() * 10).toString())
  );

  useEffect(() => {
    let frameId: number;
    const startTime = performance.now() + delay;
    const chars = "0123456789";

    const update = (now: number) => {
      if (now < startTime) {
        setDisplay(
          target.replace(/[0-9]/g, () => chars[Math.floor(Math.random() * chars.length)])
        );
        frameId = requestAnimationFrame(update);
        return;
      }

      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      if (progress >= 1) {
        setDisplay(target);
        return;
      }

      const numCharsToLock = Math.floor(progress * target.length);
      const scrambled = target
        .split("")
        .map((char, index) => {
          if (!/[0-9]/.test(char)) return char;
          if (index < numCharsToLock) return char;
          return chars[Math.floor(Math.random() * chars.length)];
        })
        .join("");

      setDisplay(scrambled);
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [target, duration, delay]);

  return display;
}

export function HeroSection() {
  const docsAnalyzed = useRandomizedNumber("12,847", 1500, 200);
  const feesDetected = useRandomizedNumber("$2.4B", 1500, 200);
  const riskAlerts = useRandomizedNumber("8,421", 1500, 200);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
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
          className="terminal-card terminal-glow relative overflow-hidden"
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          {/* Edge hover lighting only (masked to border perimeter, no light on the graph) */}
          {isHovering && (
            <div
              className="pointer-events-none absolute inset-0 z-50 rounded-[inherit] transition-opacity duration-300"
              style={{
                background: `radial-gradient(350px circle at ${mousePos.x}px ${mousePos.y}px, hsl(68 100% 45% / 0.85), transparent 40%)`,
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
                <span className="font-mono text-sm font-bold text-primary tabular-nums">{docsAnalyzed}</span>
              </div>
              <svg viewBox="0 0 400 120" className="w-full h-28 overflow-visible">
                <defs>
                  <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(68, 100%, 45%)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="hsl(68, 100%, 45%)" stopOpacity="0" />
                  </linearGradient>
                  <clipPath id="chartReveal">
                    <motion.rect
                      x="0"
                      y="0"
                      height="120"
                      initial={{ width: 0 }}
                      animate={{ width: 400 }}
                      transition={{ duration: 1.5, ease: [0.25, 1, 0.5, 1], delay: 0.2 }}
                    />
                  </clipPath>
                </defs>

                {/* Gradient area fill revealing in sync with the line */}
                <path
                  d="M 0,100 L 40,85 L 80,90 L 120,60 L 160,70 L 200,40 L 240,55 L 280,25 L 320,35 L 360,15 L 400,10 L 400,120 L 0,120 Z"
                  fill="url(#chartGrad)"
                  clipPath="url(#chartReveal)"
                />

                {/* Line graph building itself from 0 to peak */}
                <motion.path
                  d="M 0,100 L 40,85 L 80,90 L 120,60 L 160,70 L 200,40 L 240,55 L 280,25 L 320,35 L 360,15 L 400,10"
                  fill="none"
                  stroke="hsl(68, 100%, 45%)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.5, ease: [0.25, 1, 0.5, 1], delay: 0.2 }}
                />

                {/* Pulse beacon at the peak */}
                <motion.circle
                  cx="400"
                  cy="10"
                  r="3"
                  fill="hsl(68, 100%, 45%)"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 1.7, duration: 0.3 }}
                />
                <motion.circle
                  cx="400"
                  cy="10"
                  r="6"
                  fill="none"
                  stroke="hsl(68, 100%, 45%)"
                  strokeWidth="1"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: [1, 1.8, 1], opacity: [0.8, 0, 0.8] }}
                  transition={{ delay: 1.8, duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
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
                <span className="font-display text-2xl font-bold text-foreground block tabular-nums">{feesDetected}</span>
                <span className="font-mono text-[10px] text-primary">Δ +18M (24H)</span>
              </div>
              <div className="p-4">
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase block mb-2">
                  RISK ALERTS
                </span>
                <span className="font-display text-xl font-bold text-foreground block tabular-nums">{riskAlerts}</span>
                <div className="w-full h-1 bg-border mt-2">
                  <motion.div
                    className="h-full bg-primary"
                    initial={{ width: "0%" }}
                    animate={{ width: "75%" }}
                    transition={{ duration: 1.5, ease: [0.25, 1, 0.5, 1], delay: 0.2 }}
                  />
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
        </motion.div>
      </div>
    </section>
  );
}
