import React from "react";

interface ChangkongLogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

export function ChangkongLogo({ size = "md", showText = true, className = "" }: ChangkongLogoProps) {
  const pixelSize = size === "sm" ? 32 : size === "lg" ? 64 : 44;

  return (
    <div
      className={`ck-logo-container ck-size-${size} ${className}`}
      title="南京航空航天大学 · 长空御风战队 (NUAA ChangKong YuFeng RoboMaster Team)"
    >
      <div className="ck-logo-badge" style={{ width: pixelSize, height: pixelSize }}>
        <svg
          viewBox="0 0 160 160"
          className="ck-svg"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Cyber Gradient for Aerospace Wings */}
            <linearGradient id="ckWingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.95" />
              <stop offset="50%" stopColor="#0284c7" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0369a1" stopOpacity="0.6" />
            </linearGradient>

            {/* Jet Afterburner Amber Core */}
            <radialGradient id="ckCoreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="30%" stopColor="#00f0ff" stopOpacity="0.9" />
              <stop offset="70%" stopColor="#0284c7" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#00f0ff" stopOpacity="0" />
            </radialGradient>

            {/* Radar Sweep Gradient */}
            <linearGradient id="ckRadarSweep" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#00f0ff" stopOpacity="0" />
            </linearGradient>

            {/* Afterburner Thruster Flame */}
            <linearGradient id="ckFlameGrad" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
              <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </linearGradient>

            {/* Glow Filter */}
            <filter id="ckNeonGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background Ambient Glow */}
          <circle cx="80" cy="80" r="66" className="ck-bg-ambient" />

          {/* Outer Tactical Reticle Ring (RoboMaster Targeting) */}
          <circle cx="80" cy="80" r="74" className="ck-outer-ring" />
          <circle cx="80" cy="80" r="70" className="ck-inner-ring" />

          {/* Reticle Tick Marks */}
          <g className="ck-ticks">
            <line x1="80" y1="4" x2="80" y2="11" />
            <line x1="80" y1="149" x2="80" y2="156" />
            <line x1="4" y1="80" x2="11" y2="80" />
            <line x1="149" y1="80" x2="156" y2="80" />
            <line x1="26" y1="26" x2="31" y2="31" />
            <line x1="134" y1="26" x2="129" y2="31" />
            <line x1="26" y1="134" x2="31" y2="129" />
            <line x1="134" y1="134" x2="129" y2="129" />
          </g>

          {/* Animated Radar Scanning Sector */}
          <g className="ck-radar-group">
            <path
              d="M 80 80 L 80 10 A 70 70 0 0 1 130 30 Z"
              fill="url(#ckRadarSweep)"
            />
            <line x1="80" y1="80" x2="80" y2="10" className="ck-radar-beam" />
          </g>

          {/* Aerodynamic Wind Flow Lines ("御风" - Cosmic Wind Trails) */}
          <g className="ck-wind-trails">
            <path d="M 25 50 Q 50 65 72 74" className="ck-wind-line ck-wind-1" />
            <path d="M 135 50 Q 110 65 88 74" className="ck-wind-line ck-wind-2" />
            <path d="M 32 95 Q 55 90 70 84" className="ck-wind-line ck-wind-3" />
            <path d="M 128 95 Q 105 90 90 84" className="ck-wind-line ck-wind-4" />
          </g>

          {/* Afterburner Thruster Jet Trail */}
          <path
            d="M 74 102 Q 80 132 80 136 Q 80 132 86 102 Z"
            fill="url(#ckFlameGrad)"
            className="ck-thruster-flame"
          />

          {/* Tactical Hex-Shield Chassis (RoboMaster Armor Motif) */}
          <polygon
            points="80,18 132,48 132,108 80,138 28,108 28,48"
            className="ck-hex-shield"
          />

          {/* NUAA Delta Wing Aerospace Fighter (长空 - Fighter Jet Wings) */}
          {/* Main Swept Wings */}
          <path
            d="M 80 28 
               L 102 62 
               L 142 84 
               L 110 92 
               L 88 88 
               L 80 108 
               L 72 88 
               L 50 92 
               L 18 84 
               L 58 62 Z"
            fill="url(#ckWingGrad)"
            className="ck-delta-wing"
            filter="url(#ckNeonGlow)"
          />

          {/* Wing Leading Edge Streamlines & Panel Lines */}
          <g className="ck-wing-accents">
            {/* Center Fuselage Cockpit Spear */}
            <polygon points="80,30 84,68 80,82 76,68" fill="#e0f2fe" opacity="0.9" />
            {/* Wing Inset Decals */}
            <path d="M 80 42 L 118 78 L 102 83 L 80 58 Z" fill="#38bdf8" opacity="0.4" />
            <path d="M 80 42 L 42 78 L 58 83 L 80 58 Z" fill="#38bdf8" opacity="0.4" />
            {/* Leading Edge Highlight Lines */}
            <line x1="80" y1="28" x2="142" y2="84" stroke="#ffffff" strokeWidth="1.2" opacity="0.8" />
            <line x1="80" y1="28" x2="18" y2="84" stroke="#ffffff" strokeWidth="1.2" opacity="0.8" />
          </g>

          {/* Central Reactor Core (Glowing Cyan Energy Reactor) */}
          <circle cx="80" cy="74" r="14" fill="url(#ckCoreGlow)" className="ck-energy-core" />
          <circle cx="80" cy="74" r="6" fill="#ffffff" className="ck-core-center" />
          <circle cx="80" cy="74" r="9" className="ck-core-ring" />

          {/* Micro Tactical Markings */}
          <text x="80" y="122" className="ck-tactical-text" textAnchor="middle">
            NUAA · RM
          </text>
        </svg>
      </div>

      {showText && (
        <div className="ck-brand-info">
          <div className="ck-team-title">
            <span className="ck-title-uni">南京航空航天大学</span>
            <span className="ck-title-sep">·</span>
            <span className="ck-title-team">长空御风战队</span>
          </div>
          <div className="ck-team-sub">
            <span className="ck-tag-rm">ROBOMASTER</span>
            <span className="ck-sub-en">CHANGKONG YUFENG</span>
          </div>
        </div>
      )}
    </div>
  );
}
