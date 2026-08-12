import React from 'react';
import { useCurrentFrame, interpolate, AbsoluteFill } from 'remotion';
import { Image as ImageIcon, Code2, Clapperboard, Check } from 'lucide-react';
import { COLORS, EASINGS, RADIUS, SHADOW } from '../../brand';
import { FONT_BODY, FONT_MONO } from '../../fonts';
import { BrandBg, CLAMP, useRise } from '../../lib/kit';

// =============================================================================
// DEMO — beat de demostración de /make-tsx: las tres rutas de b-roll del repo
// (docs/BROLL-RUTAS.md) entrando en stagger, con el highlight en fal (la única
// con movimiento real). Sin cues de narración: es un shot suelto de muestra.
// =============================================================================
export const compositionConfig = { id: 'TresRutasBroll', durationInSeconds: 8, fps: 30, width: 1920, height: 1080 };

const ROUTES = [
  {
    icon: ImageIcon, color: COLORS.accent, name: 'Blotato',
    what: 'imagen gpt-image-1 + Ken Burns', price: '$0.30', note: 'por 9 s', appear: 24,
  },
  {
    icon: Code2, color: COLORS.accent2, name: 'Remotion',
    what: 'beat visual autorado en código', price: '$0', note: 'solo render local', appear: 38,
  },
  {
    icon: Clapperboard, color: COLORS.signal, name: 'fal',
    what: 'nanobanana + veo3.1 lite i2v', price: '$0.43', note: 'por 9 s', appear: 52,
  },
] as const;

const TresRutasBroll: React.FC = () => {
  const frame = useCurrentFrame();
  const rise = useRise();

  // highlight sobre fal: anillo + leve escala, con calma (nada de cartoon)
  const ring = interpolate(frame, [110, 126], [0, 1], { ...CLAMP, easing: EASINGS.easeOut });
  const pulse = interpolate(frame, [110, 126], [1, 1.035], { ...CLAMP, easing: EASINGS.overshoot });
  const badge = interpolate(frame, [126, 140], [0, 1], { ...CLAMP, easing: EASINGS.overshoot });

  return (
    <AbsoluteFill style={{ fontFamily: FONT_BODY, color: COLORS.ink }}>
      <BrandBg glow={COLORS.signal} />

      {/* kicker + título */}
      <div style={{ position: 'absolute', top: 128, width: '100%', textAlign: 'center' }}>
        <div style={{ ...rise(0), display: 'inline-block', fontFamily: FONT_MONO, fontSize: 26, letterSpacing: 4, color: COLORS.muted, border: `1px solid ${COLORS.line}`, borderRadius: RADIUS.pill, padding: '10px 28px', background: COLORS.cream }}>
          B-ROLL CON IA
        </div>
        <h1 style={{ ...rise(8), fontSize: 84, fontWeight: 800, letterSpacing: -2, margin: '30px 0 0' }}>
          Tres rutas, <span style={{ color: COLORS.accent }}>una decisión por momento</span>
        </h1>
      </div>

      {/* las tres tarjetas */}
      <div style={{ position: 'absolute', top: 430, width: '100%', display: 'flex', justifyContent: 'center', gap: 44 }}>
        {ROUTES.map((r, i) => {
          const isFal = i === 2;
          const Icon = r.icon;
          return (
            <div key={r.name} style={{
              ...rise(r.appear, 34),
              width: 430, background: '#fff', borderRadius: RADIUS.card, boxShadow: SHADOW.card,
              border: `1px solid ${COLORS.line}`, padding: '42px 40px 38px', position: 'relative',
              transform: `${rise(r.appear, 34).transform} scale(${isFal ? pulse : 1})`,
              outline: isFal ? `4px solid ${COLORS.signal}` : 'none',
              outlineOffset: 0,
              ...(isFal ? { outlineColor: `${COLORS.signal}${Math.round(ring * 255).toString(16).padStart(2, '0')}` } : {}),
            }}>
              <div style={{ width: 84, height: 84, borderRadius: 22, background: `${r.color}1c`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 26 }}>
                <Icon size={44} color={r.color} strokeWidth={2.2} />
              </div>
              <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>{r.name}</div>
              <div style={{ fontSize: 26, color: COLORS.muted, margin: '10px 0 30px', lineHeight: 1.4 }}>{r.what}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                <span style={{ fontFamily: FONT_MONO, fontSize: 56, fontWeight: 700, color: r.color }}>{r.price}</span>
                <span style={{ fontSize: 24, color: COLORS.muted }}>{r.note}</span>
              </div>
              {isFal && (
                <div style={{
                  position: 'absolute', top: -26, right: 26, display: 'flex', alignItems: 'center', gap: 10,
                  background: COLORS.signal, color: '#fff', borderRadius: RADIUS.pill, padding: '10px 22px',
                  fontSize: 24, fontWeight: 700, boxShadow: SHADOW.soft,
                  opacity: badge, transform: `scale(${badge})`,
                }}>
                  <Check size={24} strokeWidth={3} /> movimiento real
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* cierre */}
      <div style={{ position: 'absolute', bottom: 96, width: '100%', textAlign: 'center' }}>
        <div style={{ ...rise(160), fontFamily: FONT_MONO, fontSize: 28, color: COLORS.muted }}>
          la ruta se elige en el GATE 1 · <span style={{ color: COLORS.ink }}>docs/BROLL-RUTAS.md</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
export default TresRutasBroll;
