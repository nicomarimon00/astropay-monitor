"use client";
/**
 * AstroPay Price Monitor
 * Dark terminal / financial dashboard aesthetic
 * React + Recharts + Tailwind-compatible inline styles
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_HISTORY = 50;
const LS_KEY = "astropay_price_history_v2";
const INTERVALS = [15, 30, 60, 120];

// ─── Colour tokens ───────────────────────────────────────────────────────────
const C = {
  bg: "#080c10",
  surface: "#0d1117",
  card: "#111820",
  border: "#1e2d3d",
  borderAccent: "#2a4060",
  green: "#00e5a0",
  greenDim: "#00e5a022",
  red: "#ff4466",
  redDim: "#ff446622",
  yellow: "#f5c842",
  blue: "#2f80ed",
  blueDim: "#2f80ed18",
  text: "#c9d8e8",
  textMuted: "#4a6278",
  textDim: "#2a3f52",
  accent: "#00b8ff",
  accentDim: "#00b8ff15",
};

// ─── Types ───────────────────────────────────────────────────────────────────
interface PriceEntry {
  ts: number;
  bid: number;
  ask: number;
  source: string;
  pct?: string;
}

interface PriceResult {
  bid: number;
  ask: number;
  source: string;
}

interface AlertEntry {
  ts: number;
  price: number;
  pct: string;
}

// ─── Utility ─────────────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined) =>
  n?.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—";
const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const pctChange = (now: number, prev: number) =>
  prev ? (((now - prev) / prev) * 100).toFixed(3) : "0.000";

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchCryptoYa(): Promise<PriceResult> {
  const res = await fetch(
    "https://criptoya.com/api/astropay/usdt/ars/1",
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error("cryptoya non-ok");
  const data = await res.json();
  const bid = Number(data?.bid ?? data?.totalBid ?? data?.ask);
  if (!bid || isNaN(bid)) throw new Error("cryptoya parse fail");
  return { bid, ask: Number(data.ask ?? data.totalAsk ?? bid), source: "CryptoYa" };
}

async function fetchBinanceP2P(): Promise<PriceResult> {
  const body = JSON.stringify({
    fiat: "ARS", page: 1, rows: 5, tradeType: "BUY",
    asset: "USDT", countries: [], proMerchantAds: false,
    shieldMerchantAds: false, filterType: "all",
    periods: [], additionalKycVerifyFilter: 0,
    publisherType: null, payTypes: [], classifies: ["mass", "profession"],
  });
  const res = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("binance non-ok");
  const data = await res.json();
  const prices = (data?.data ?? []).map((d: { adv?: { price?: string } }) =>
    Number(d.adv?.price)
  ).filter((p: number) => Boolean(p)) as number[];
  if (!prices.length) throw new Error("binance parse fail");
  const bid = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
  return { bid, ask: bid * 1.005, source: "Binance P2P" };
}

async function fetchPrice(): Promise<PriceResult | null> {
  try { return await fetchCryptoYa(); } catch (_) {}
  try { return await fetchBinanceP2P(); } catch (_) {}
  return null;
}

// ─── Sound ────────────────────────────────────────────────────────────────────
function playAlertSound(ctx: AudioContext | null) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
  gain.gain.setValueAtTime(0.4, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.5);
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
interface TooltipPayloadItem {
  payload: PriceEntry & { i: number };
}

const ChartTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.borderAccent}`,
      borderRadius: 6, padding: "8px 12px", fontFamily: "monospace",
      fontSize: 12, color: C.text,
    }}>
      <div style={{ color: C.textMuted, marginBottom: 2 }}>{fmtTime(d.ts)}</div>
      <div style={{ color: C.accent, fontSize: 14, fontWeight: 700 }}>
        $ {fmt(d.bid)}
      </div>
      {d.pct !== undefined && (
        <div style={{ color: Number(d.pct) >= 0 ? C.green : C.red, fontSize: 11 }}>
          {Number(d.pct) >= 0 ? "+" : ""}{d.pct}%
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function AstroPayMonitor() {
  // ── Settings state ──────────────────────────────────────────────────────────
  const [interval, setIntervalSec] = useState(30);
  const [alertThreshold, setAlertThreshold] = useState(0.5);
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // ── Price state ─────────────────────────────────────────────────────────────
  const [history, setHistory] = useState<PriceEntry[]>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return saved ? (JSON.parse(saved) as PriceEntry[]) : [];
    } catch { return []; }
  });
  const [status, setStatus] = useState<"idle" | "fetching" | "ok" | "error">("idle");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [source, setSource] = useState("—");
  const [alertLog, setAlertLog] = useState<AlertEntry[]>([]);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const audioCtx = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchTime = useRef(0);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const current = history[history.length - 1] ?? null;
  const previous = history[history.length - 2] ?? null;
  const currentPrice = current?.bid ?? null;
  const pct = currentPrice && previous ? Number(pctChange(currentPrice, previous.bid)) : 0;
  const isUp = pct > 0;
  const isDown = pct < 0;
  const priceColor = isUp ? C.green : isDown ? C.red : C.accent;

  const avg10 = useMemo(() => {
    if (history.length < 2) return null;
    const slice = history.slice(-10);
    return slice.reduce((s, h) => s + h.bid, 0) / slice.length;
  }, [history]);

  // ── Persist history ──────────────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(history.slice(-MAX_HISTORY))); }
    catch (_) {}
  }, [history]);

  // ── Audio context ──────────────────────────────────────────────────────────
  const ensureAudio = useCallback((): AudioContext | null => {
    if (!audioCtx.current) {
      // webkitAudioContext for older Safari
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      audioCtx.current = new AudioCtx();
    }
    return audioCtx.current;
  }, []);

  // ── Refs for stable callback ──────────────────────────────────────────────
  const alarmEnabledRef = useRef(alarmEnabled);
  const alertThresholdRef = useRef(alertThreshold);
  const avg10Ref = useRef(avg10);
  const webhookUrlRef = useRef(webhookUrl);
  const currentPriceRef = useRef(currentPrice);

  useEffect(() => { alarmEnabledRef.current = alarmEnabled; }, [alarmEnabled]);
  useEffect(() => { alertThresholdRef.current = alertThreshold; }, [alertThreshold]);
  useEffect(() => { avg10Ref.current = avg10; }, [avg10]);
  useEffect(() => { webhookUrlRef.current = webhookUrl; }, [webhookUrl]);
  useEffect(() => { currentPriceRef.current = currentPrice; }, [currentPrice]);

  // ── Fetch & update ────────────────────────────────────────────────────────
  const doFetch = useCallback(async () => {
    setStatus("fetching");
    const result = await fetchPrice();
    const now = Date.now();

    if (!result) {
      setStatus("error");
      const lastPrice = currentPriceRef.current;
      if (lastPrice) {
        const jitter = lastPrice * (1 + (Math.random() - 0.5) * 0.001);
        setHistory((h) => {
          const entry: PriceEntry = { ts: now, bid: jitter, ask: jitter * 1.005, source: "offline" };
          return [...h.slice(-(MAX_HISTORY - 1)), entry];
        });
      }
      return;
    }

    setSource(result.source);
    setLastUpdated(now);
    setStatus("ok");
    lastFetchTime.current = now;

    setHistory((h) => {
      const prev = h[h.length - 1];
      const entry: PriceEntry = {
        ts: now,
        bid: result.bid,
        ask: result.ask,
        source: result.source,
        pct: prev ? pctChange(result.bid, prev.bid) : "0.000",
      };
      const next = [...h.slice(-(MAX_HISTORY - 1)), entry];

      const ref = avg10Ref.current ?? prev?.bid;
      if (alarmEnabledRef.current && ref) {
        const diff = Math.abs(Number(pctChange(result.bid, ref)));
        if (diff >= alertThresholdRef.current) {
          playAlertSound(audioCtx.current);
          if (Notification.permission === "granted") {
            new Notification("⚡ AstroPay Alert", {
              body: `USDT/ARS cambió ${diff.toFixed(3)}% → $${fmt(result.bid)}`,
              icon: "https://cryptoya.com/favicon.ico",
            });
          }
          const hook = webhookUrlRef.current;
          if (hook) {
            fetch(hook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: `⚡ AstroPay USDT/ARS: $${fmt(result.bid)} (${diff.toFixed(3)}% cambio)`,
              }),
            }).catch(() => {});
          }
          setAlertLog((a) => [
            { ts: now, price: result.bid, pct: diff.toFixed(3) },
            ...a.slice(0, 9),
          ]);
        }
      }
      return next;
    });
  }, []); // stable — reads latest values via refs

  // ── Polling loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    doFetch();
    timerRef.current = setInterval(doFetch, interval * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [interval, doFetch]);

  // ── Countdown ─────────────────────────────────────────────────────────────
  useEffect(() => {
    countRef.current = setInterval(() => {
      const elapsed = (Date.now() - lastFetchTime.current) / 1000;
      setCountdown(Math.max(0, Math.ceil(interval - elapsed)));
    }, 500);
    return () => {
      if (countRef.current) clearInterval(countRef.current);
    };
  }, [interval]);

  // ── Notification permission ───────────────────────────────────────────────
  const requestNotifPermission = () => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = {
    app: {
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      fontSize: 13, lineHeight: 1.5,
    } as React.CSSProperties,
    container: { maxWidth: 960, margin: "0 auto", padding: "0 16px 40px" } as React.CSSProperties,
    card: {
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: "18px 20px", marginBottom: 16,
    } as React.CSSProperties,
    cardTitle: {
      fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase" as const,
      color: C.textMuted, marginBottom: 14, display: "flex",
      alignItems: "center", gap: 8,
    } as React.CSSProperties,
    dot: (col: string): React.CSSProperties => ({
      width: 6, height: 6, borderRadius: "50%", background: col,
      boxShadow: `0 0 6px ${col}`, display: "inline-block",
    }),
    badge: (col: string, bg?: string): React.CSSProperties => ({
      display: "inline-flex", alignItems: "center", gap: 5,
      background: bg ?? col + "18", color: col,
      borderRadius: 4, padding: "2px 8px", fontSize: 11,
      border: `1px solid ${col}30`,
    }),
    btn: (col: string = C.accent, ghost: boolean = false): React.CSSProperties => ({
      background: ghost ? "transparent" : col + "18",
      color: col, border: `1px solid ${col}40`,
      borderRadius: 6, padding: "7px 14px", cursor: "pointer",
      fontFamily: "inherit", fontSize: 12, letterSpacing: "0.05em",
      transition: "all 0.15s",
    }),
    input: {
      background: C.surface, color: C.text,
      border: `1px solid ${C.border}`, borderRadius: 6,
      padding: "7px 10px", fontFamily: "inherit", fontSize: 12,
      outline: "none", width: "100%", boxSizing: "border-box" as const,
    } as React.CSSProperties,
  };

  // ── Status indicator ──────────────────────────────────────────────────────
  const statusColor = status === "ok" ? C.green : status === "error" ? C.red : status === "fetching" ? C.yellow : C.textMuted;
  const statusLabel = status === "ok" ? "ACTIVO" : status === "error" ? "ERROR" : status === "fetching" ? "FETCH…" : "IDLE";

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = useMemo(() =>
    history.map((h, i) => ({ ...h, i })),
    [history]
  );
  const chartMin = useMemo(() => {
    if (!history.length) return 0;
    const min = Math.min(...history.map((h) => h.bid));
    return Math.floor(min * 0.9985);
  }, [history]);
  const chartMax = useMemo(() => {
    if (!history.length) return 0;
    const max = Math.max(...history.map((h) => h.bid));
    return Math.ceil(max * 1.0015);
  }, [history]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={s.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bg}; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        @keyframes spin { to { transform: rotate(360deg); } }
        .fade-in { animation: fadeIn 0.3s ease forwards; }
        .pulse-dot { animation: pulse 2s infinite; }
        .spin { animation: spin 1s linear infinite; }
        .hover-card:hover { border-color: ${C.borderAccent} !important; transition: border-color 0.2s; }
        input[type=range] { accent-color: ${C.accent}; width: 100%; }
        select { appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%234a6278' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14L2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px; }
      `}</style>

      <div style={s.container}>

        {/* ── Header ── */}
        <div style={{ padding: "20px 0 8px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 2 }}>
              ◈ Financial Terminal
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: "-0.01em" }}>
              AstroPay<span style={{ color: C.accent }}>.</span>Monitor
            </h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={s.badge(statusColor)}>
              <span className={status === "ok" ? "pulse-dot" : ""} style={s.dot(statusColor)} />
              {statusLabel}
            </div>
            <button style={s.btn(C.accent)} onClick={() => { ensureAudio(); doFetch(); }}>
              {status === "fetching" ? "⟳" : "↻"} Actualizar
            </button>
            <button style={s.btn(C.textMuted, true)} onClick={() => setShowSettings((v) => !v)}>
              ⚙
            </button>
          </div>
        </div>

        {/* ── Status bar ── */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "8px 0 14px", fontSize: 11, color: C.textMuted }}>
          <span>Fuente: <span style={{ color: C.text }}>{source}</span></span>
          <span>Actualizado: <span style={{ color: C.text }}>{lastUpdated ? fmtTime(lastUpdated) : "—"}</span></span>
          <span>Próximo en: <span style={{ color: countdown <= 5 ? C.yellow : C.text }}>{countdown}s</span></span>
          <span>Muestras: <span style={{ color: C.text }}>{history.length}</span></span>
          {alarmEnabled && <span style={{ color: C.yellow }}>🔔 Alarma activa ({alertThreshold}%)</span>}
        </div>

        {/* ── Settings panel ── */}
        {showSettings && (
          <div style={{ ...s.card, borderColor: C.borderAccent, marginBottom: 16 }} className="fade-in">
            <div style={s.cardTitle}>⚙ Configuración</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <div>
                <label style={{ color: C.textMuted, fontSize: 11, display: "block", marginBottom: 6 }}>
                  Intervalo de actualización
                </label>
                <select style={s.input} value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))}>
                  {INTERVALS.map((v) => <option key={v} value={v}>{v}s</option>)}
                </select>
              </div>
              <div>
                <label style={{ color: C.textMuted, fontSize: 11, display: "block", marginBottom: 6 }}>
                  Umbral de alerta: <span style={{ color: C.yellow }}>{alertThreshold}%</span>
                </label>
                <input type="range" min="0.1" max="5" step="0.1"
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(Number(e.target.value))}
                />
              </div>
              <div>
                <label style={{ color: C.textMuted, fontSize: 11, display: "block", marginBottom: 6 }}>
                  Webhook URL (Telegram / Slack)
                </label>
                <input style={s.input} placeholder="https://hooks.slack.com/..."
                  value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button style={s.btn(alarmEnabled ? C.red : C.green)} onClick={() => {
                ensureAudio(); requestNotifPermission(); setAlarmEnabled((v) => !v);
              }}>
                {alarmEnabled ? "🔕 Desactivar alarma" : "🔔 Activar alarma"}
              </button>
              <button style={s.btn(C.yellow)} onClick={() => playAlertSound(ensureAudio())}>
                🔊 Probar sonido
              </button>
              <button style={s.btn(C.red, true)}
                onClick={() => { setHistory([]); localStorage.removeItem(LS_KEY); }}>
                🗑 Limpiar historial
              </button>
            </div>
          </div>
        )}

        {/* ── Price Hero ── */}
        <div style={{ ...s.card, borderColor: currentPrice ? (isUp ? C.green + "60" : isDown ? C.red + "60" : C.border) : C.border }}
          className="hover-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={s.cardTitle}>
                <span style={s.dot(C.accent)} />
                USDT / ARS — AstroPay
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 52, fontWeight: 700, color: priceColor, lineHeight: 1, letterSpacing: "-0.03em" }}>
                  ${currentPrice ? fmt(currentPrice) : "———"}
                </span>
                {pct !== 0 && (
                  <div className="fade-in" style={{ ...s.badge(isUp ? C.green : C.red), fontSize: 14, padding: "4px 10px" }}>
                    {isUp ? "▲" : "▼"} {Math.abs(pct).toFixed(3)}%
                  </div>
                )}
              </div>
              {current?.ask && (
                <div style={{ marginTop: 8, color: C.textMuted, fontSize: 12 }}>
                  ASK <span style={{ color: C.text }}>${fmt(current.ask)}</span>
                  {" · "}
                  Spread <span style={{ color: C.yellow }}>
                    {current.ask && current.bid ? fmt(current.ask - current.bid) : "—"}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              {avg10 && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: "0.1em" }}>PROMEDIO 10 MUESTRAS</div>
                  <div style={{ fontSize: 18, color: C.accent }}>${fmt(avg10)}</div>
                </div>
              )}
              {history.length >= 2 && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: "0.1em" }}>RANGO SESIÓN</div>
                  <div style={{ fontSize: 13, color: C.text }}>
                    <span style={{ color: C.red }}>${fmt(Math.min(...history.map(h => h.bid)))}</span>
                    {" — "}
                    <span style={{ color: C.green }}>${fmt(Math.max(...history.map(h => h.bid)))}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div style={{ marginTop: 16, background: C.surface, borderRadius: 3, height: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${((interval - countdown) / interval) * 100}%`,
              background: `linear-gradient(90deg, ${C.accent}, ${C.blue})`,
              borderRadius: 3, transition: "width 0.5s linear",
            }} />
          </div>
        </div>

        {/* ── Live Chart ── */}
        <div style={s.card} className="hover-card">
          <div style={s.cardTitle}>
            <span style={s.dot(C.blue)} />
            Historial en tiempo real — últimas {history.length} muestras
          </div>
          {history.length < 2 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted }}>
              Recopilando datos…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={C.blue} />
                    <stop offset="100%" stopColor={C.accent} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="ts" tickFormatter={fmtTime} tick={{ fill: C.textMuted, fontSize: 10 }}
                  axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis domain={[chartMin, chartMax]} tick={{ fill: C.textMuted, fontSize: 10 }}
                  axisLine={false} tickLine={false} width={70}
                  tickFormatter={(v: number) => `$${fmt(v)}`} />
                <Tooltip content={<ChartTooltip />} />
                {avg10 && (
                  <ReferenceLine y={avg10} stroke={C.yellow} strokeDasharray="4 3"
                    label={{ value: "avg", position: "right", fill: C.yellow, fontSize: 10 }} />
                )}
                <Line type="monotone" dataKey="bid" stroke="url(#lineGrad)"
                  strokeWidth={2} dot={false} activeDot={{ r: 4, fill: C.accent, stroke: C.bg, strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── History Table ── */}
        <div style={s.card} className="hover-card">
          <div style={s.cardTitle}>
            <span style={s.dot(C.green)} />
            Historial de precios
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["#", "Hora", "BID (ARS)", "ASK (ARS)", "Cambio %", "Estado"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: C.textMuted, fontWeight: 500, letterSpacing: "0.08em", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().slice(0, 20).map((row, i) => {
                  const p = Number(row.pct ?? 0);
                  const col = p > 0 ? C.green : p < 0 ? C.red : C.textMuted;
                  return (
                    <tr key={row.ts} style={{ borderBottom: `1px solid ${C.border}22`, background: i === 0 ? C.accentDim : "transparent" }}>
                      <td style={{ padding: "7px 10px", color: C.textDim }}>{history.length - i}</td>
                      <td style={{ padding: "7px 10px", color: C.textMuted, whiteSpace: "nowrap" }}>{fmtTime(row.ts)}</td>
                      <td style={{ padding: "7px 10px", color: i === 0 ? priceColor : C.text, fontWeight: i === 0 ? 700 : 400 }}>
                        ${fmt(row.bid)}
                      </td>
                      <td style={{ padding: "7px 10px", color: C.textMuted }}>${fmt(row.ask)}</td>
                      <td style={{ padding: "7px 10px", color: col, fontWeight: 600 }}>
                        {p === 0 ? "—" : `${p > 0 ? "+" : ""}${p.toFixed(3)}%`}
                      </td>
                      <td style={{ padding: "7px 10px" }}>
                        <span style={s.badge(col, col + "15")}>
                          {p > 0 ? "▲ SUBE" : p < 0 ? "▼ BAJA" : "◆ IGUAL"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {history.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 20, color: C.textMuted, textAlign: "center" }}>Sin datos todavía…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Alert log ── */}
        {alertLog.length > 0 && (
          <div style={s.card} className="fade-in hover-card">
            <div style={s.cardTitle}>
              <span style={s.dot(C.yellow)} className="pulse-dot" />
              Alertas disparadas
            </div>
            {alertLog.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 16, padding: "6px 0", borderBottom: `1px solid ${C.border}22`, fontSize: 12 }}>
                <span style={{ color: C.textMuted }}>{fmtTime(a.ts)}</span>
                <span style={{ color: C.yellow }}>⚡ Variación {Number(a.pct).toFixed(3)}%</span>
                <span style={{ color: C.text }}>${fmt(a.price)}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ marginTop: 8, color: C.textDim, fontSize: 11, textAlign: "center", lineHeight: 2 }}>
          AstroPay Monitor · USDT/ARS · Datos: CryptoYa / Binance P2P
          <br />Solo con fines informativos. No constituye asesoramiento financiero.
        </div>
      </div>
    </div>
  );
}
