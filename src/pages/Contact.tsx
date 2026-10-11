import { StatusBar } from "@/components/landing/StatusBar";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { ArrowRight, Check } from "lucide-react";
import { useState, useRef } from "react";

export default function Contact() {
  const [status, setStatus] = useState<"idle" | "sent">("idle");
  const [charCount, setCharCount] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!formRef.current) return;
    const rect = formRef.current.getBoundingClientRect();
    formRef.current.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    formRef.current.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sent");
    setTimeout(() => {
      setStatus("idle");
    }, 3500);
  };

  return (
    <div className="page-enter min-h-screen bg-background grid-bg scanline relative">
      <StatusBar />
      <div className="pt-10">
        <Navbar />
        
        <main className="min-h-[calc(100vh-140px)] w-full py-16 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto">
            {/* Minimal Status Pill */}
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-primary/5 border border-primary/20 text-primary text-[10px] font-mono tracking-widest uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                <span>DISPATCH CHANNEL // SECURE UPLINK ACTIVE</span>
              </div>
            </div>

            {/* Refined 2-Column Balanced Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
              
              {/* Left Column: Elegant restrained typography & coordinates */}
              <div className="lg:col-span-5 flex flex-col gap-6 pt-1">
                <div>
                  <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold text-foreground tracking-tight uppercase leading-[1.1]">
                    GET IN TOUCH <br />
                    <span className="italic text-primary font-medium lowercase">with the</span> AUDIT CORE<span className="text-primary">.</span>
                  </h1>
                  <p className="mt-4 text-muted-foreground font-mono text-[13px] leading-relaxed">
                    Direct access for enterprise contract audits, fee obfuscation reporting, or custom quantitative model provisioning.
                  </p>
                </div>

                {/* Structured Info Coordinates */}
                <div className="border-t border-border/50 pt-6 flex flex-col gap-5 text-[12px]">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] tracking-wider text-muted-foreground/80 uppercase font-mono">01 // DIRECT INTERFACE</span>
                    <span className="text-foreground font-mono font-medium hover:text-primary transition-colors cursor-pointer">mail@truecost.com</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] tracking-wider text-muted-foreground/80 uppercase font-mono">02 // RESPONSE LATENCY</span>
                    <span className="text-muted-foreground font-mono">Typically &lt; 2 hours for institutional syndicate inquiries</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] tracking-wider text-muted-foreground/80 uppercase font-mono">03 // CRYPTOGRAPHIC ASSURANCE</span>
                    <div className="flex items-center justify-between text-muted-foreground font-mono text-[11px] pt-0.5">
                      <span>PGP: 4096-BIT RSA (0x90A2...8F1)</span>
                      <span className="text-primary cursor-pointer hover:underline">[DL KEY]</span>
                    </div>
                  </div>
                </div>

                {/* Clean Security Tag */}
                <div className="p-3 bg-card border border-border text-[11px] text-muted-foreground font-mono">
                  <span className="text-primary font-bold">ZERO-LOG:</span> All submitted covenant terms and communications scrubbed deterministically via ephemeral memory buffers.
                </div>
              </div>

              {/* Right Column: Sleek Minimalist Terminal Card Form */}
              <div 
                ref={formRef}
                className="lg:col-span-7 relative group"
                onMouseMove={handleMouseMove}
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
              >
                {/* Ambient background light behind the terminal form card (135px radius) */}
                <div 
                  className="pointer-events-none absolute -inset-6 transition-opacity duration-200 blur-2xl -z-10 rounded-2xl will-change-transform"
                  style={{
                    opacity: isHovering ? 1 : 0,
                    background: `radial-gradient(135px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), hsl(68 100% 45% / 0.45), transparent 70%)`
                  }}
                />

                <div className="terminal-card terminal-glow bg-card p-7 sm:p-9 relative overflow-hidden z-10">
                  {/* Subtle 20% light effect on top of component (135px radius) */}
                  <div 
                    className="pointer-events-none absolute inset-0 transition-opacity duration-200 z-20 will-change-transform"
                    style={{
                      opacity: isHovering ? 0.2 : 0,
                      background: `radial-gradient(135px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), hsl(68 100% 45% / 0.5), transparent 70%)`
                    }}
                  />

                  {/* Terminal Header Bar inside Card */}
                  <div className="flex items-center justify-between border-b border-border/50 pb-4 mb-6 relative z-10">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-primary"></span>
                      <span className="font-mono text-[11px] text-foreground tracking-widest uppercase font-bold">TRANSMISSION SPECIFICATION</span>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">TLS_1.3 // ECDH-25519</span>
                  </div>

                  <form className="space-y-5" onSubmit={handleSubmit}>
                    {/* Name & Email Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase flex justify-between">
                          <span>CALLSIGN / NAME</span>
                          <span className="text-primary">*</span>
                        </label>
                        <input 
                          type="text" 
                          required 
                          className="bg-background border border-border focus:border-primary text-foreground font-mono text-[12px] px-3.5 py-2.5 outline-none transition-colors placeholder-muted-foreground/50" 
                          placeholder="e.g. Vance, Principal Q" 
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase flex justify-between">
                          <span>INSTITUTIONAL EMAIL</span>
                          <span className="text-primary">*</span>
                        </label>
                        <input 
                          type="email" 
                          required 
                          className="bg-background border border-border focus:border-primary text-foreground font-mono text-[12px] px-3.5 py-2.5 outline-none transition-colors placeholder-muted-foreground/50" 
                          placeholder="quant@syndicate.fund" 
                        />
                      </div>
                    </div>

                    {/* Topic Selection Pills */}
                    <div className="flex flex-col gap-2">
                      <label className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                        TRANSMISSION TOPIC
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="flex items-center gap-2 p-2.5 bg-background border border-border cursor-pointer hover:border-primary/50 transition-colors group">
                          <input type="radio" name="topic" value="audit" className="accent-primary w-3 h-3" defaultChecked />
                          <span className="font-mono text-[11px] text-muted-foreground group-hover:text-foreground uppercase transition-colors">Contract Audit</span>
                        </label>
                        <label className="flex items-center gap-2 p-2.5 bg-background border border-border cursor-pointer hover:border-primary/50 transition-colors group">
                          <input type="radio" name="topic" value="model" className="accent-primary w-3 h-3" />
                          <span className="font-mono text-[11px] text-muted-foreground group-hover:text-foreground uppercase transition-colors">Custom Model</span>
                        </label>
                        <label className="flex items-center gap-2 p-2.5 bg-background border border-border cursor-pointer hover:border-primary/50 transition-colors group">
                          <input type="radio" name="topic" value="general" className="accent-primary w-3 h-3" />
                          <span className="font-mono text-[11px] text-muted-foreground group-hover:text-foreground uppercase transition-colors">Inquiry</span>
                        </label>
                      </div>
                    </div>

                    {/* Payload Message */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                        <span>MESSAGE / COVENANT DETAILS</span>
                        <span className="text-muted-foreground/60">{charCount} / 2048 B</span>
                      </div>
                      <textarea 
                        rows={5} 
                        maxLength={2048}
                        onChange={(e) => setCharCount(e.target.value.length)}
                        className="bg-background border border-border focus:border-primary text-foreground font-mono text-[12px] p-3.5 outline-none transition-colors placeholder-muted-foreground/50 resize-none leading-relaxed" 
                        placeholder="// Outline contract terms, suspect synthetic APR spread, or technical inquiry..."
                      ></textarea>
                    </div>

                    {/* Submit Button Action */}
                    <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                        <span className="w-1.5 h-1.5 bg-primary animate-pulse-dot"></span>
                        <span>ENCRYPTED DISPATCH READY</span>
                      </div>
                      <button 
                        type="submit" 
                        className={`font-display font-semibold text-[12px] tracking-widest uppercase px-6 py-3 transition-colors flex items-center justify-center gap-2 cursor-pointer ${status === "sent" ? "bg-foreground text-background" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                      >
                        {status === "sent" ? (
                          <>
                            <span>[ TRANSMISSION DISPATCHED ]</span>
                            <Check className="w-4 h-4" />
                          </>
                        ) : (
                          <>
                            <span>[ SEND TRANSMISSION ]</span>
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </main>
        
        <Footer />
      </div>
    </div>
  );
}
