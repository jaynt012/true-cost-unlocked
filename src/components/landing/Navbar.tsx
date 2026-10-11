import { Link, useLocation } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { User } from "lucide-react";

export function Navbar() {
  const location = useLocation();
  const isContactPage = location.pathname === "/contact";

  return (
    <nav className="flex items-center justify-between px-4 sm:px-8 py-5 mt-8">
      <div className="flex items-center gap-3">
        <Link to="/" className="flex items-center gap-3 group">
          <span className="font-display text-xl font-bold text-foreground tracking-tight group-hover:text-primary transition-colors">TRUE COST</span>
          <span className="font-mono text-[10px] border border-border px-2 py-0.5 text-muted-foreground group-hover:border-primary/50 group-hover:text-primary transition-colors">TC-01</span>
        </Link>
      </div>

      <div className="hidden md:flex items-center gap-8 font-mono text-[11px] tracking-widest uppercase text-muted-foreground">
        {isContactPage ? (
          <Link to="/" className="hover:text-primary transition-colors flex items-center gap-1 font-bold text-foreground">
            <span className="text-primary/70">::</span> HOME
          </Link>
        ) : (
          <>
            <a href="#features" className="hover:text-primary transition-colors">
              <span className="text-primary/50 mr-1">01</span> FEATURES
            </a>
            <a href="#architecture" className="hover:text-primary transition-colors">
              <span className="text-primary/50 mr-1">02</span> ARCHITECTURE
            </a>
            <a href="/#pricing" className="hover:text-primary transition-colors">
              <span className="text-primary/50 mr-1">03</span> PRICING
            </a>
            <Link to="/contact" className="hover:text-primary transition-colors">
              <span className="text-primary/50 mr-1">04</span> CONTACT
            </Link>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <ThemeToggle />
        <button
          type="button"
          className="relative flex items-center justify-center w-9 h-9 border border-border bg-card/40 text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-card hover:shadow-[0_0_12px_hsl(68_100%_45%/0.2)] transition-all duration-300 group cursor-pointer"
          aria-label="Profile"
          title="Profile"
        >
          <User className="w-4 h-4 transition-transform duration-300 group-hover:scale-110" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary ring-2 ring-background transition-transform duration-300 group-hover:scale-110" />
        </button>
      </div>
    </nav>
  );
}
