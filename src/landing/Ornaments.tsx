// Ornamentos em traço fino, inspirados na arte da marca.

export function Sparkle({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0c.6 6.4 5.6 11.4 12 12-6.4.6-11.4 5.6-12 12-.6-6.4-5.6-11.4-12-12C6.4 11.4 11.4 6.4 12 0z" fill="currentColor" />
    </svg>
  );
}

export function Heart({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M12 20s-7.5-4.6-9.3-9.2C1.4 7.4 3.6 4 7 4c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 15.4 12 20 12 20z" />
    </svg>
  );
}

/** Linha — estrela — linha, como no flyer. */
export function Divider({ icon = 'sparkle' }: { icon?: 'sparkle' | 'heart' }) {
  return (
    <div className="ornament-divider" aria-hidden="true">
      <span />
      {icon === 'heart' ? <Heart size={18} /> : <Sparkle size={14} />}
      <span />
    </div>
  );
}

/** Linha ondulada rose gold que passa atrás da galeria. */
export function WavyLine({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 150 C 180 40, 320 40, 470 120 S 760 210, 900 110 S 1110 30, 1200 80"
        fill="none" stroke="url(#wave-gold)" strokeWidth="1.6"
      />
      <path
        d="M0 165 C 190 60, 330 60, 480 135 S 770 225, 910 125 S 1115 50, 1200 98"
        fill="none" stroke="url(#wave-gold)" strokeWidth="0.8" opacity="0.6"
      />
      <defs>
        <linearGradient id="wave-gold" x1="0" x2="1">
          <stop offset="0" stopColor="#f5d3c3" stopOpacity="0" />
          <stop offset="0.2" stopColor="#f5d3c3" />
          <stop offset="0.5" stopColor="#d79d84" />
          <stop offset="0.8" stopColor="#f5d3c3" />
          <stop offset="1" stopColor="#f5d3c3" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.15a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24s8.24 3.7 8.24 8.24-3.7 8.24-8.24 8.24zm4.52-6.17c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" />
    </svg>
  );
}

export function InstagramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function PinIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

export function ClockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
