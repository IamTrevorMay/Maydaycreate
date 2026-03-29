import React, { useState, useEffect, useRef } from 'react';

interface TrainingMonsterProps {
  state: 'idle' | 'working-out' | 'celebrating';
  progress: number; // 0-100 tiredness
  speechText?: string;
  mood?: 'bored'; // bored = droopy idle when no data
}

export function TrainingMonster({ state, progress, speechText, mood }: TrainingMonsterProps): React.ReactElement {
  const [blink, setBlink] = useState(false);
  const blinkTimer = useRef<ReturnType<typeof setTimeout>>();

  // Periodic blink in idle/celebrating
  useEffect(() => {
    if (state === 'working-out') return;
    const scheduleBlink = () => {
      blinkTimer.current = setTimeout(() => {
        setBlink(true);
        setTimeout(() => {
          setBlink(false);
          scheduleBlink();
        }, 150);
      }, 2500 + Math.random() * 2000);
    };
    scheduleBlink();
    return () => { if (blinkTimer.current) clearTimeout(blinkTimer.current); };
  }, [state]);

  // Tiredness phases
  const phase = progress < 30 ? 0 : progress < 60 ? 1 : progress < 85 ? 2 : 3;
  const sweatCount = state === 'working-out' ? [0, 2, 4, 6][phase] : 0;

  return (
    <div style={{ position: 'relative', width: 160, height: 200 }}>
      <style>{keyframes}</style>

      {/* Speech bubble */}
      {speechText && state !== 'working-out' && (
        <div style={{
          position: 'absolute',
          top: -8,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#2a2a3e',
          border: '1px solid #444',
          borderRadius: 8,
          padding: '4px 10px',
          fontSize: 10,
          color: '#e0e0e0',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          {speechText}
          <div style={{
            position: 'absolute',
            bottom: -5,
            left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: 8,
            height: 8,
            background: '#2a2a3e',
            border: '1px solid #444',
            borderTop: 'none',
            borderLeft: 'none',
          }} />
        </div>
      )}

      {/* Monster SVG */}
      <svg
        viewBox="0 0 160 200"
        width={160}
        height={200}
        style={{
          animation: state === 'idle' ? 'monster-bob 2s ease-in-out infinite'
            : state === 'celebrating' ? 'monster-celebrate 0.6s ease-in-out infinite'
            : `jump-rope ${0.6 + phase * 0.15}s ease-in-out infinite`,
        }}
      >
        {/* ── Sweat drops ── */}
        {state === 'working-out' && Array.from({ length: sweatCount }).map((_, i) => (
          <ellipse
            key={`sweat-${i}`}
            cx={50 + i * 12 + (i % 2 ? 5 : 0)}
            cy={55 + i * 3}
            rx={2}
            ry={3}
            fill="#60a5fa"
            opacity={0.7}
            style={{
              animation: `sweat-drop 1.2s ease-in ${i * 0.2}s infinite`,
            }}
          />
        ))}

        {/* ── Sparkles (celebrating) ── */}
        {state === 'celebrating' && Array.from({ length: 8 }).map((_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          const cx = 80 + Math.cos(angle) * 70;
          const cy = 100 + Math.sin(angle) * 70;
          return (
            <g key={`sparkle-${i}`} style={{ animation: `sparkle 0.8s ease-in-out ${i * 0.1}s infinite` }}>
              <line x1={cx - 4} y1={cy} x2={cx + 4} y2={cy} stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" />
              <line x1={cx} y1={cy - 4} x2={cx} y2={cy + 4} stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" />
            </g>
          );
        })}

        {/* ── Sneakers ── */}
        <ellipse cx={65} cy={178} rx={12} ry={6} fill="#f0f0f0" stroke="#ccc" strokeWidth={0.5} />
        <ellipse cx={95} cy={178} rx={12} ry={6} fill="#f0f0f0" stroke="#ccc" strokeWidth={0.5} />
        {/* Shoe stripes */}
        <line x1={59} y1={177} x2={71} y2={177} stroke="#ef4444" strokeWidth={1.5} />
        <line x1={89} y1={177} x2={101} y2={177} stroke="#ef4444" strokeWidth={1.5} />

        {/* ── Legs ── */}
        <rect x={68} y={155} width={8} height={24} rx={4} fill="#7c6fef" />
        <rect x={84} y={155} width={8} height={24} rx={4} fill="#7c6fef" />

        {/* ── Gym shorts ── */}
        <path d="M60,145 Q80,142 100,145 L98,162 Q90,158 80,158 Q70,158 62,162 Z" fill="#38bdf8" />
        <line x1={80} y1={145} x2={80} y2={158} stroke="#2196F3" strokeWidth={0.8} opacity={0.5} />

        {/* ── Body (purple blob) ── */}
        <ellipse cx={80} cy={115} rx={35} ry={35} fill="#7c6fef" />

        {/* ── Tank top ── */}
        <path d="M52,100 Q55,88 65,85 Q80,82 95,85 Q105,88 108,100 L108,145 Q80,150 52,145 Z" fill="#f472b6" />
        {/* Tank top white trim */}
        <path d="M52,100 Q55,88 65,85 Q80,82 95,85 Q105,88 108,100" fill="none" stroke="#fff" strokeWidth={1.5} />
        {/* Tank top arm holes */}
        <path d="M52,100 Q48,105 48,115" fill="none" stroke="#fff" strokeWidth={1} />
        <path d="M108,100 Q112,105 112,115" fill="none" stroke="#fff" strokeWidth={1} />

        {/* ── Arms ── */}
        {state === 'celebrating' ? (
          <>
            {/* Arms up - victory! */}
            <rect x={38} y={80} width={8} height={28} rx={4} fill="#7c6fef" transform="rotate(-30 42 94)" />
            <rect x={114} y={80} width={8} height={28} rx={4} fill="#7c6fef" transform="rotate(30 118 94)" />
            {/* Fists */}
            <circle cx={35} cy={72} r={5} fill="#7c6fef" />
            <circle cx={125} cy={72} r={5} fill="#7c6fef" />
          </>
        ) : (
          <>
            {/* Arms at sides / holding rope */}
            <rect x={40} y={105} width={8} height={24} rx={4} fill="#7c6fef" />
            <rect x={112} y={105} width={8} height={24} rx={4} fill="#7c6fef" />
            {/* Hands */}
            <circle cx={44} cy={130} r={5} fill="#7c6fef" />
            <circle cx={116} cy={130} r={5} fill="#7c6fef" />
          </>
        )}

        {/* ── Wristbands ── */}
        {state === 'celebrating' ? (
          <>
            <rect x={34} y={78} width={12} height={5} rx={2} fill="#fbbf24" />
            <rect x={118} y={78} width={12} height={5} rx={2} fill="#fbbf24" />
          </>
        ) : (
          <>
            <rect x={39} y={123} width={12} height={5} rx={2} fill="#fbbf24" />
            <rect x={109} y={123} width={12} height={5} rx={2} fill="#fbbf24" />
          </>
        )}

        {/* ── Head ── */}
        <ellipse cx={80} cy={72} rx={26} ry={24} fill="#7c6fef" />

        {/* ── Headband ── */}
        <path d="M55,65 Q80,55 105,65" fill="none" stroke="#fbbf24" strokeWidth={5} strokeLinecap="round" />
        {/* Headband knot */}
        <circle cx={105} cy={65} r={3} fill="#fbbf24" />
        {/* Headband tails */}
        <path d="M105,65 Q112,70 110,80" fill="none" stroke="#fbbf24" strokeWidth={2.5} strokeLinecap="round"
          style={state === 'celebrating' ? { animation: 'headband-flap 0.4s ease-in-out infinite' } : undefined} />
        <path d="M105,65 Q115,68 114,76" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round"
          style={state === 'celebrating' ? { animation: 'headband-flap 0.4s ease-in-out 0.1s infinite' } : undefined} />

        {/* ── Eyes ── */}
        {state === 'celebrating' ? (
          <>
            {/* Star eyes */}
            <StarEye cx={71} cy={70} />
            <StarEye cx={89} cy={70} />
          </>
        ) : (
          <>
            {/* Normal eyes */}
            <ellipse cx={71} cy={70} rx={6} ry={blink ? 1 : 6} fill="#fff" />
            <ellipse cx={89} cy={70} rx={6} ry={blink ? 1 : 6} fill="#fff" />
            {/* Pupils */}
            {!blink && (
              <>
                <circle cx={71} cy={71} r={3} fill="#1a1a2e" />
                <circle cx={89} cy={71} r={3} fill="#1a1a2e" />
                {/* Eye shine */}
                <circle cx={69} cy={69} r={1.2} fill="#fff" />
                <circle cx={87} cy={69} r={1.2} fill="#fff" />
              </>
            )}
            {/* Half-lidded overlay when tired or bored */}
            {(state === 'working-out' && phase >= 2) && (
              <>
                <rect x={64} y={62} width={14} height={phase >= 3 ? 8 : 5} rx={2} fill="#7c6fef" />
                <rect x={82} y={62} width={14} height={phase >= 3 ? 8 : 5} rx={2} fill="#7c6fef" />
              </>
            )}
            {state === 'idle' && mood === 'bored' && (
              <>
                <rect x={64} y={62} width={14} height={5} rx={2} fill="#7c6fef" />
                <rect x={82} y={62} width={14} height={5} rx={2} fill="#7c6fef" />
              </>
            )}
          </>
        )}

        {/* ── Mouth ── */}
        {state === 'celebrating' ? (
          // Big happy open mouth
          <path d="M72,82 Q80,92 88,82" fill="#1a1a2e" stroke="none" />
        ) : state === 'working-out' ? (
          phase === 0 ? (
            // Big smile
            <path d="M72,82 Q80,90 88,82" fill="none" stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" />
          ) : phase === 1 ? (
            // Flat
            <line x1={73} y1={83} x2={87} y2={83} stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" />
          ) : phase === 2 ? (
            // Frown
            <path d="M73,85 Q80,80 87,85" fill="none" stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" />
          ) : (
            // Exhausted — tongue out
            <>
              <ellipse cx={80} cy={84} rx={6} ry={4} fill="#1a1a2e" />
              <ellipse cx={80} cy={89} rx={4} ry={5} fill="#f472b6" />
            </>
          )
        ) : mood === 'bored' ? (
          // Bored flat mouth
          <line x1={73} y1={84} x2={87} y2={85} stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" />
        ) : (
          // Idle smile
          <path d="M72,82 Q80,90 88,82" fill="none" stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" />
        )}

        {/* ── Jump Rope ── */}
        {state === 'working-out' && (
          <path
            d="M44,130 Q80,195 116,130"
            fill="none"
            stroke="#4ade80"
            strokeWidth={2.5}
            strokeLinecap="round"
            style={{
              animation: `rope-spin ${0.6 + phase * 0.15}s linear infinite`,
              transformOrigin: '80px 130px',
            }}
          />
        )}
      </svg>
    </div>
  );
}

function StarEye({ cx, cy }: { cx: number; cy: number }): React.ReactElement {
  // 5-point star
  const r = 6;
  const inner = 2.5;
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const outerAngle = (i * 72 - 90) * (Math.PI / 180);
    const innerAngle = ((i * 72 + 36) - 90) * (Math.PI / 180);
    pts.push(`${cx + r * Math.cos(outerAngle)},${cy + r * Math.sin(outerAngle)}`);
    pts.push(`${cx + inner * Math.cos(innerAngle)},${cy + inner * Math.sin(innerAngle)}`);
  }
  return <polygon points={pts.join(' ')} fill="#fbbf24" />;
}

const keyframes = `
@keyframes monster-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

@keyframes monster-celebrate {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-12px) rotate(-3deg); }
  75% { transform: translateY(-12px) rotate(3deg); }
}

@keyframes jump-rope {
  0%, 100% { transform: translateY(0) scaleY(1); }
  15% { transform: translateY(0) scaleY(0.92) scaleX(1.04); }
  40% { transform: translateY(-18px) scaleY(1.05) scaleX(0.96); }
  60% { transform: translateY(-18px) scaleY(1.05) scaleX(0.96); }
  80% { transform: translateY(2px) scaleY(0.92) scaleX(1.04); }
}

@keyframes rope-spin {
  0% { d: path("M44,130 Q80,195 116,130"); }
  25% { d: path("M44,130 Q80,60 116,130"); }
  50% { d: path("M44,130 Q80,195 116,130"); }
  75% { d: path("M44,130 Q80,60 116,130"); }
}

@keyframes sweat-drop {
  0% { transform: translateY(0); opacity: 0; }
  20% { opacity: 0.7; }
  100% { transform: translateY(25px); opacity: 0; }
}

@keyframes sparkle {
  0%, 100% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.2); opacity: 1; }
}

@keyframes headband-flap {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(10deg); }
}
`;
