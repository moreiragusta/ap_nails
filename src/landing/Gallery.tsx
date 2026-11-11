import { useCallback, useEffect, useRef, useState } from 'react';
import { WavyLine } from './Ornaments';

interface Photo { src: string; alt: string }

const ROTATIONS = [-4, 3.5, -2, 5, -5.5, 2.5, -3, 4.5];
const FLY_MS = 300;

/** Galeria em pilha de cartões: arrastar para o lado passa para a próxima foto. */
export default function Gallery({ photos }: { photos: Photo[] }) {
  const n = photos.length;
  const [order, setOrder] = useState(() => photos.map((_, i) => i));
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState<0 | 1 | -1>(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  const next = useCallback((dir: 1 | -1 = 1) => {
    if (flying) return;
    if (dir === 1) {
      setFlying(1);
      window.setTimeout(() => {
        setOrder((o) => [...o.slice(1), o[0]]);
        setFlying(0);
        setDx(0);
      }, FLY_MS);
    } else {
      setOrder((o) => [o[o.length - 1], ...o.slice(0, -1)]);
      setDx(0);
    }
  }, [flying]);

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDx(e.clientX - start.current.x);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s) return;
    const moved = e.clientX - s.x;
    if (Math.abs(moved) > 80) {
      setDx(moved);
      next(1);
    } else {
      setDx(0);
      if (Math.abs(moved) < 6 && Date.now() - s.t < 400) setLightbox(order[0]);
    }
  };

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') setLightbox((i) => (i === null ? i : (i + 1) % n));
      if (e.key === 'ArrowLeft') setLightbox((i) => (i === null ? i : (i - 1 + n) % n));
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [lightbox, n]);

  if (!n) return null;
  const visible = order.slice(0, Math.min(4, n));

  return (
    <div className="gallery">
      <WavyLine className="gallery-wave" />
      <div className="gallery-stack" role="group" aria-roledescription="galeria" aria-label="Trabalhos da Amanda">
        {[...visible].reverse().map((idx) => {
          const depth = visible.indexOf(idx);
          const isTop = depth === 0;
          const rot = ROTATIONS[idx % ROTATIONS.length];
          let transform = `translate(${depth * 6}px, ${depth * 8}px) rotate(${rot}deg) scale(${1 - depth * 0.035})`;
          if (isTop) {
            const x = flying ? Math.sign(dx || 1) * 520 : dx;
            transform = `translate(${x}px, ${Math.abs(x) * 0.06}px) rotate(${rot + x / 18}deg)`;
          }
          return (
            <figure
              key={idx}
              className={`gallery-card${isTop ? ' is-top' : ''}${isTop && dragging ? ' is-dragging' : ''}`}
              style={{ transform, zIndex: 10 - depth, opacity: isTop && flying ? 0 : 1 }}
              {...(isTop ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } : {})}
            >
              <img src={photos[idx].src} alt={photos[idx].alt} draggable={false} loading={depth > 1 ? 'lazy' : 'eager'} />
            </figure>
          );
        })}
      </div>
      <div className="gallery-controls">
        <button type="button" className="gallery-arrow" onClick={() => next(-1)} aria-label="Foto anterior">‹</button>
        <span className="gallery-count" aria-live="polite">{order[0] + 1} / {n}</span>
        <button type="button" className="gallery-arrow" onClick={() => next(1)} aria-label="Próxima foto">›</button>
      </div>
      <p className="gallery-hint">Arraste para o lado · toque para ampliar</p>

      {lightbox !== null && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={photos[lightbox].alt} onClick={() => setLightbox(null)}>
          <img src={photos[lightbox].src} alt={photos[lightbox].alt} onClick={(e) => e.stopPropagation()} />
          <button type="button" className="lightbox-close" aria-label="Fechar">✕</button>
          {n > 1 && (
            <>
              <button type="button" className="lightbox-nav prev" aria-label="Anterior"
                onClick={(e) => { e.stopPropagation(); setLightbox((lightbox - 1 + n) % n); }}>‹</button>
              <button type="button" className="lightbox-nav next" aria-label="Próxima"
                onClick={(e) => { e.stopPropagation(); setLightbox((lightbox + 1) % n); }}>›</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
