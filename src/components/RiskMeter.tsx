import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";
import { riskBandForScore, type RiskBand } from "@/lib/riskScoring";

interface Props {
  score: number;
  band?: RiskBand;
  incomplete?: boolean;
}

export function RiskMeter({ score, band = riskBandForScore(score), incomplete = false }: Props) {
  const getColor = () => {
    if (band === "low") return "hsl(68, 100%, 45%)";
    if (band === "caution") return "hsl(45, 93%, 50%)";
    if (band === "high") return "hsl(24, 95%, 53%)";
    return "hsl(0, 72%, 55%)";
  };

  const getLabel = () => {
    const label = band === "caution" ? "CAUTION" : `${band.toUpperCase()} RISK`;
    return incomplete ? `${label} (partial analysis)` : label;
  };

  const clampedScore = Math.min(Math.max(score, 0), 100);
  const rotation = (clampedScore / 100) * 180 - 90;
  const animatedScore = useMotionValue(0);
  const scoreLabel = useTransform(animatedScore, (value) => `${value.toFixed(1)}/100`);

  useEffect(() => {
    const controls = animate(animatedScore, clampedScore, { duration: 2.6, ease: "easeInOut" });
    return controls.stop;
  }, [animatedScore, clampedScore]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-48 h-24 overflow-hidden">
        <div className="absolute inset-0 rounded-t-full border-[10px] border-border" style={{ borderBottom: "none" }} />
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 100">
          <defs>
            <linearGradient id="riskGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(68, 100%, 45%)" />
              <stop offset="50%" stopColor="hsl(45, 93%, 50%)" />
              <stop offset="100%" stopColor="hsl(0, 72%, 55%)" />
            </linearGradient>
          </defs>
          <path d="M 12 100 A 88 88 0 0 1 188 100" fill="none" stroke="url(#riskGrad)" strokeWidth="10" strokeLinecap="round" opacity="0.25" />
        </svg>
        <motion.div
          className="absolute bottom-0 left-1/2 origin-bottom"
          style={{ width: 2, height: 75, marginLeft: -1 }}
          initial={{ rotate: -90 }}
          animate={{ rotate: rotation }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
        >
          <div className="w-full h-full" style={{ backgroundColor: getColor() }} />
        </motion.div>
        <div className="absolute bottom-0 left-1/2 w-3 h-3 -ml-1.5 -mb-1.5 rounded-full bg-foreground" />
      </div>
      <div className="text-center">
        <motion.span
          className="text-2xl font-mono font-bold"
          style={{ color: getColor() }}
        >
          {scoreLabel}
        </motion.span>
        <p className="font-mono text-[10px] tracking-widest text-muted-foreground mt-1">{getLabel()}</p>
        {incomplete && <p className="font-mono text-[10px] text-muted-foreground">Based on detected findings; some terms could not be extracted.</p>}
      </div>
    </div>
  );
}
