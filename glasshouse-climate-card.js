/*!
 * Glasshouse Climate Card v1.0.0
 * A dial thermostat for one HVAC zone, with the zone's rooms beside it.
 * Part of the Glasshouse card suite. MIT License (c) 2026 Peter Gray.
 */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const TAG = 'glasshouse-climate-card';

  const DEBOUNCE_MS = 800;      // set_temperature is called this long after the last change
  const TARGET_TTL = 15000;     // how long a sent target is shown while waiting for the device
  const MODE_TTL = 8000;

  // Dial geometry (SVG user units; viewBox is 240 x 240)
  const VB = 240, CX = 120, CY = 120, R = 92;
  const START = 135, SWEEP = 270; // degrees, 0 = right, clockwise

  const MODE_META = {
    off: { icon: 'mdi:power', label: 'Off' },
    heat: { icon: 'mdi:fire', label: 'Heat' },
    cool: { icon: 'mdi:snowflake', label: 'Cool' },
    heat_cool: { icon: 'mdi:sun-snowflake-variant', label: 'Auto' },
    auto: { icon: 'mdi:thermostat-auto', label: 'Schedule' },
    dry: { icon: 'mdi:water-percent', label: 'Dry' },
    fan_only: { icon: 'mdi:fan', label: 'Fan' },
  };
  const MODE_ORDER = ['heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only', 'off'];
  const ACTION_TEXT = {
    heating: 'Heating', preheating: 'Preheating', cooling: 'Cooling', drying: 'Drying',
    fan: 'Fan only', idle: 'Idle', off: 'Off', defrosting: 'Defrosting',
  };
  const FAN_ICON = {
    auto: 'mdi:fan-auto', on: 'mdi:fan', off: 'mdi:fan-off', low: 'mdi:fan-speed-1',
    medium: 'mdi:fan-speed-2', middle: 'mdi:fan-speed-2', high: 'mdi:fan-speed-3',
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isNum = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);
  const MINUS = '−';
  let uid = 0;

  const STYLE = `
    :host {
      --gh-font: var(--glasshouse-font, -apple-system, "SF Pro Text", Inter, Roboto, system-ui, sans-serif);
      --gh-surface: var(--glasshouse-surface, rgba(255,255,255,0.045));
      --gh-surface-2: var(--glasshouse-surface-2, rgba(255,255,255,0.075));
      --gh-border: var(--glasshouse-border, rgba(255,255,255,0.09));
      --gh-blur: var(--glasshouse-blur, 18px);
      --gh-radius: var(--glasshouse-radius, 22px);
      --gh-radius-sm: var(--glasshouse-radius-sm, 14px);
      --gh-pad: var(--glasshouse-pad, 16px);
      --gh-gap: var(--glasshouse-gap, 10px);
      --gh-text: var(--glasshouse-text, #e9eef6);
      --gh-text-2: var(--glasshouse-text-2, #93a0b5);
      --gh-text-3: var(--glasshouse-text-3, #5d697d);
      --gh-ok: var(--glasshouse-ok, #3fb950);
      --gh-warn: var(--glasshouse-warn, #e3b341);
      --gh-alert: var(--glasshouse-alert, #ff5c5c);
      --gh-info: var(--glasshouse-info, #58a6ff);
      --gh-light: var(--glasshouse-light, #ffb547);
      --gh-fan: var(--glasshouse-fan, #4dd6e8);
      --gh-cover: var(--glasshouse-cover, #a3a8ff);
      --gh-switch: var(--glasshouse-switch, #7ee08a);
      --gh-heat: var(--glasshouse-heat, #ff7a59);
      --gh-cool: var(--glasshouse-cool, #58a6ff);
      --gh-media: var(--glasshouse-media, #c48cff);
      --gh-lock: var(--glasshouse-lock, #3fb950);
      --gh-security: var(--glasshouse-security, #ff5c5c);
      --gh-energy: var(--glasshouse-energy, #f6d365);
      --gh-water: var(--glasshouse-water, #4aa8ff);
      --gh-neutral: var(--glasshouse-neutral, #93a0b5);
      --gh-ease: 160ms ease;
      display: block;
    }
    * { box-sizing: border-box; }
    ha-card {
      --acc: var(--gh-neutral);
      --acc-a: var(--gh-cool);
      --acc-b: var(--gh-heat);
      --gh-accent: var(--acc);
      display: block; position: relative; overflow: hidden;
      container: gh-clim / inline-size;
      background: var(--gh-surface);
      border: 1px solid var(--gh-border);
      border-radius: var(--gh-radius);
      -webkit-backdrop-filter: blur(var(--gh-blur)) saturate(140%);
      backdrop-filter: blur(var(--gh-blur)) saturate(140%);
      padding: var(--gh-pad);
      color: var(--gh-text);
      font-family: var(--gh-font);
      font-size: 13px; font-weight: 500; line-height: 1.3;
      -webkit-font-smoothing: antialiased;
    }
    ha-card[data-tone="heat"] { --acc: var(--gh-heat); }
    ha-card[data-tone="cool"] { --acc: var(--gh-cool); }
    ha-card[data-tone="dual"] { --acc: color-mix(in srgb, var(--gh-heat) 55%, var(--gh-cool)); }
    ha-card[data-tone="dry"] { --acc: var(--gh-water); }
    ha-card[data-tone="fan"] { --acc: var(--gh-fan); }
    ha-card[data-tone="off"] { --acc: var(--gh-neutral); }
    /* ambient wash in the corner of the card, tinted by the mode */
    ha-card::before {
      content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
      background: radial-gradient(520px 340px at 0% 0%, color-mix(in srgb, var(--acc) 9%, transparent), transparent 70%);
      transition: background var(--gh-ease);
    }
    ha-card[data-tone="off"]::before, ha-card.unavail::before { background: none; }
    button {
      font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0;
      cursor: pointer; -webkit-tap-highlight-color: transparent;
    }
    button:focus { outline: none; }
    button:focus-visible { outline: 2px solid var(--gh-accent); outline-offset: 2px; }
    button:disabled { cursor: default; }
    ha-icon { display: inline-flex; --mdc-icon-size: 22px; }
    [hidden] { display: none !important; }
    .vh {
      position: absolute !important; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
    }

    /* ---------- header ---------- */
    .head { position: relative; display: flex; align-items: center; gap: 12px; min-height: 44px; }
    .zone {
      display: flex; align-items: center; gap: 12px; flex: 1 1 auto; min-width: 0;
      text-align: left; border-radius: 12px;
    }
    .zone-ic {
      position: relative; flex: 0 0 auto; width: 44px; height: 44px; border-radius: 50%;
      display: grid; place-items: center;
      background: var(--gh-surface-2); color: var(--gh-text-2);
      transition: background var(--gh-ease), color var(--gh-ease), box-shadow var(--gh-ease);
    }
    ha-card.on .zone-ic {
      background: color-mix(in srgb, var(--acc) 16%, transparent);
      color: var(--acc);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acc) 45%, transparent), 0 0 18px -6px var(--acc);
    }
    .badge {
      position: absolute; right: -3px; bottom: -3px; width: 18px; height: 18px; border-radius: 50%;
      display: grid; place-items: center; background: #1b2333; color: var(--gh-warn);
      box-shadow: 0 0 0 2px rgba(10,14,22,0.92);
    }
    .badge ha-icon { --mdc-icon-size: 14px; }
    .titles { min-width: 0; }
    .title {
      font-size: 16px; font-weight: 650; letter-spacing: -0.005em; line-height: 1.25;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sub {
      margin-top: 2px; color: var(--gh-text-2); font-size: 13px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .chips { display: flex; gap: 6px; flex: 0 0 auto; }
    .chip {
      position: relative; display: inline-flex; align-items: center; gap: 5px;
      height: 32px; padding: 0 11px 0 8px; border-radius: 999px;
      background: var(--gh-surface-2); color: var(--gh-text);
      font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap;
      transition: background var(--gh-ease);
    }
    .chip::before { content: ""; position: absolute; inset: -6px -2px; }
    .chip ha-icon { --mdc-icon-size: 18px; color: var(--gh-text-2); }
    .chip.hum ha-icon { color: var(--gh-water); }
    .chip.out ha-icon { color: var(--gh-energy); }
    .chip .k { color: var(--gh-text-2); font-weight: 500; }
    .chip:hover { background: rgba(255,255,255,0.11); }
    @container gh-clim (max-width: 430px) { .chip .k { display: none; } }
    @container gh-clim (max-width: 330px) { .chip.out { display: none; } }

    /* ---------- body layout ---------- */
    .body { position: relative; display: grid; gap: 14px 22px; margin-top: 10px; grid-template-columns: minmax(0, 1fr); }
    .left { display: flex; flex-direction: column; align-items: center; gap: 14px; min-width: 0; }
    .right { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    @container gh-clim (min-width: 640px) {
      .body.has-rooms { grid-template-columns: minmax(280px, 330px) minmax(0, 1fr); align-items: center; }
      .body.has-rooms .right {
        align-self: stretch; justify-content: center;
        padding-left: 22px; border-left: 1px solid var(--gh-border);
      }
    }

    /* ---------- dial ---------- */
    .dial { position: relative; width: 100%; max-width: 300px; aspect-ratio: 1 / 1; margin: 0 auto; }
    .dial svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; display: block; }
    .glow {
      position: absolute; left: 50%; top: 50%; width: 74%; height: 74%;
      transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none;
      background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--acc) 30%, transparent) 0%,
        color-mix(in srgb, var(--acc) 10%, transparent) 46%, transparent 70%);
      opacity: 0; transition: opacity 400ms ease;
    }
    ha-card.active .glow { opacity: 1; animation: gh-glow 3.2s ease-in-out infinite; }
    @keyframes gh-glow {
      0%, 100% { opacity: 0.65; transform: translate(-50%, -50%) scale(0.94); }
      50% { opacity: 1; transform: translate(-50%, -50%) scale(1.05); }
    }
    .face {
      position: absolute; left: 50%; top: 50%; width: 66%; height: 66%;
      transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none;
      background: radial-gradient(circle at 50% 30%, rgba(255,255,255,0.055), rgba(255,255,255,0.012) 62%, transparent 72%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -18px 30px -24px rgba(0,0,0,0.6);
    }
    .track { fill: none; stroke: rgba(255,255,255,0.065); stroke-width: 14; stroke-linecap: round; }
    .spectrum { fill: none; stroke-width: 14; stroke-linecap: round; opacity: 0.22; transition: opacity var(--gh-ease); }
    ha-card[data-tone="off"] .spectrum, ha-card.unavail .spectrum { opacity: 0.1; }
    .active-arc {
      fill: none; stroke: var(--acc); stroke-width: 14; stroke-linecap: round;
      filter: drop-shadow(0 0 6px color-mix(in srgb, var(--acc) 55%, transparent));
      transition: stroke var(--gh-ease);
    }
    ha-card.dualarc .active-arc { stroke: var(--dual-grad); }
    .tick { stroke: var(--gh-text-3); stroke-width: 1.4; stroke-linecap: round; opacity: 0.55; }
    .tick.major { stroke: var(--gh-text-2); stroke-width: 1.6; opacity: 0.6; }
    .tick.in { stroke: var(--acc); opacity: 0.95; }
    .scale-lbl { fill: var(--gh-text-3); font: 600 9px var(--gh-font); letter-spacing: 0.04em; }
    .cur-mark { stroke: var(--gh-text); stroke-width: 3; stroke-linecap: round; opacity: 0.85; }
    .cur-dot { fill: var(--gh-text); }
    .thumb { cursor: grab; touch-action: none; }
    .thumb .halo { fill: color-mix(in srgb, var(--thumb, var(--acc)) 26%, transparent); transition: r 160ms ease; }
    .thumb .knob { fill: #f4f7fb; stroke: var(--thumb, var(--acc)); stroke-width: 3.5;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.45)); }
    .thumb.drag .halo, .thumb.focus .halo { r: 19px; }
    .thumb.focus .knob { stroke-width: 4.5; }
    .thumb.sel .knob { stroke-width: 4.5; }
    .hit { fill: none; stroke: transparent; stroke-width: 44; stroke-linecap: round; cursor: pointer; touch-action: none; }
    ha-card.unavail .hit, ha-card.unavail .thumb { pointer-events: none; }

    .center {
      position: absolute; left: 50%; top: 47%; transform: translate(-50%, -50%);
      width: 64%; display: flex; flex-direction: column; align-items: center; text-align: center;
      pointer-events: none;
    }
    .lbl {
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em;
      color: var(--gh-text-2); white-space: nowrap;
    }
    .hero {
      display: flex; align-items: flex-start; justify-content: center; gap: 2px;
      margin-top: 2px; font-size: 40px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.05;
      font-variant-numeric: tabular-nums; color: var(--gh-text); white-space: nowrap;
    }
    .hero .frac { font-size: 0.5em; margin-top: 0.12em; letter-spacing: 0; }
    .hero .deg { font-size: 0.55em; font-weight: 600; margin-top: 0.08em; color: var(--gh-text-2); }
    .hero .num { display: inline-flex; align-items: flex-start; pointer-events: auto; border-radius: 8px; }
    .hero .sep { color: var(--gh-text-3); font-weight: 500; margin: 0 4px; font-size: 0.7em; align-self: center; }
    .hero.dual { font-size: 32px; }
    .hero.dual .num { opacity: 0.55; transition: opacity var(--gh-ease); cursor: pointer; }
    .hero.dual .num.sel { opacity: 1; }
    .hero.dual .num.lo.sel .main { color: color-mix(in srgb, var(--gh-cool) 55%, var(--gh-text)); }
    .hero.dual .num.hi.sel .main { color: color-mix(in srgb, var(--gh-heat) 55%, var(--gh-text)); }
    .status {
      display: inline-flex; align-items: center; gap: 6px; margin-top: 6px;
      font-size: 13px; font-weight: 600; color: var(--gh-text); white-space: nowrap;
    }
    .status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--gh-text-3); flex: 0 0 auto; }
    ha-card.active .status .dot { background: var(--acc); box-shadow: 0 0 8px 1px var(--acc); }
    ha-card.active .status .act { color: var(--acc); }
    .now { margin-top: 2px; font-size: 13px; color: var(--gh-text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .now b { color: var(--gh-text); font-weight: 600; }

    .steppers {
      position: absolute; left: 50%; bottom: 1%; transform: translateX(-50%);
      display: flex; gap: 22px;
    }
    .step {
      width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
      background: var(--gh-surface-2); color: var(--gh-text);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
      transition: background var(--gh-ease), color var(--gh-ease), box-shadow var(--gh-ease), transform 120ms ease;
    }
    .step ha-icon { --mdc-icon-size: 20px; }
    .step:hover:not(:disabled) {
      background: color-mix(in srgb, var(--acc) 16%, transparent); color: var(--acc);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acc) 45%, transparent);
    }
    .step:active:not(:disabled) { transform: scale(0.92); }
    .step:disabled { opacity: 0.35; }

    /* ---------- modes ---------- */
    .modes {
      display: flex; width: 100%; max-width: 360px; padding: 4px; gap: 2px; border-radius: 999px;
      background: rgba(255,255,255,0.04); box-shadow: inset 0 0 0 1px var(--gh-border);
    }
    .mode {
      --m: var(--gh-neutral);
      flex: 1 1 0; min-width: 0; height: 44px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      color: var(--gh-text-2); font-size: 13px; font-weight: 600;
      transition: background var(--gh-ease), color var(--gh-ease), box-shadow var(--gh-ease);
    }
    .mode ha-icon { --mdc-icon-size: 20px; }
    .mode .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mode:hover:not(:disabled) { color: var(--gh-text); background: rgba(255,255,255,0.05); }
    .mode[aria-pressed="true"] {
      color: var(--m);
      background: color-mix(in srgb, var(--m) 16%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m) 45%, transparent), 0 0 18px -6px var(--m);
    }
    .mode[aria-pressed="true"] .t { color: var(--gh-text); }
    .mode[data-mode="heat"] { --m: var(--gh-heat); }
    .mode[data-mode="cool"] { --m: var(--gh-cool); }
    .mode[data-mode="heat_cool"], .mode[data-mode="auto"] { --m: color-mix(in srgb, var(--gh-heat) 55%, var(--gh-cool)); }
    .mode[data-mode="dry"] { --m: var(--gh-water); }
    .mode[data-mode="fan_only"] { --m: var(--gh-fan); }
    .mode[data-mode="off"] { --m: var(--gh-text); }
    .modes.many .mode .t { display: none; }
    @container gh-clim (max-width: 300px) { .modes .mode .t { display: none; } }

    /* ---------- fan ---------- */
    .fan { display: flex; align-items: center; gap: 8px; width: 100%; max-width: 360px; }
    .fan .lbl { flex: 0 0 auto; }
    .fan-opts { display: flex; gap: 6px; flex-wrap: wrap; }
    .fopt {
      display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 11px 0 8px;
      border-radius: 999px; background: var(--gh-surface-2); color: var(--gh-text-2);
      font-size: 13px; font-weight: 600; position: relative;
      transition: background var(--gh-ease), color var(--gh-ease), box-shadow var(--gh-ease);
    }
    .fopt::before { content: ""; position: absolute; inset: -6px -2px; }
    .fopt ha-icon { --mdc-icon-size: 18px; }
    .fopt[aria-pressed="true"] {
      color: var(--gh-fan); background: color-mix(in srgb, var(--gh-fan) 16%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gh-fan) 45%, transparent);
    }

    /* ---------- rooms ---------- */
    .rooms-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .rooms-head .range { font-size: 13px; color: var(--gh-text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .rooms { display: grid; gap: var(--gh-gap); grid-template-columns: repeat(2, minmax(0, 1fr)); }
    @container gh-clim (min-width: 470px) { .rooms { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @container gh-clim (min-width: 640px) { .rooms { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @container gh-clim (min-width: 860px) { .rooms { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @container gh-clim (min-width: 1100px) { .rooms { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    .room {
      --tone: var(--gh-neutral); --tp: 0%; --tpn: 0; --tc: 0%;
      position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 44px;
      padding: 11px 12px 12px; border-radius: var(--gh-radius-sm); text-align: left;
      background: linear-gradient(160deg, color-mix(in srgb, var(--tone) var(--tp), transparent), transparent 85%), var(--gh-surface-2);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) calc(var(--tpn) * 1%), rgba(255,255,255,0.025));
      transition: background var(--gh-ease), box-shadow var(--gh-ease), transform 120ms ease;
    }
    .room:hover { background-color: rgba(255,255,255,0.095); }
    .room:active { transform: scale(0.975); }
    .room .nm {
      font-size: 13px; font-weight: 600; color: var(--gh-text-2);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .room .rv { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
    .room .tv {
      font-size: 22px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1;
      font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--tone) var(--tc), var(--gh-text));
    }
    .room .tv small { font-size: 12px; font-weight: 600; color: var(--gh-text-2); margin-left: 1px; vertical-align: 0.55em; }
    .stats { display: none; gap: var(--gh-gap); grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
    .stat { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 2px 0; }
    .stat .v { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .stat .v small { font-size: 13px; font-weight: 600; color: var(--gh-text-2); margin-left: 1px; vertical-align: 0.7em; }
    .stat .v.acc { color: var(--acc); }
    .stat .lbl { overflow: hidden; text-overflow: ellipsis; }
    @container gh-clim (min-width: 640px) {
      .stats { display: grid; padding-bottom: 14px; border-bottom: 1px solid var(--gh-border); }
      ha-card.has-rooms .chips { display: none; }
      .room { padding: 13px 14px 14px; gap: 8px; }
      .room .tv { font-size: 26px; }
    }
    .room .dl {
      font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.02em;
      padding: 2px 6px; border-radius: 999px; white-space: nowrap;
      color: color-mix(in srgb, var(--tone) 85%, var(--gh-text));
      background: color-mix(in srgb, var(--tone) 16%, transparent);
    }
    .room[data-tone="neutral"] .dl { color: var(--gh-text-2); background: rgba(255,255,255,0.06); }
    .room .bar { position: relative; height: 4px; border-radius: 2px; margin-top: 2px;
      background: linear-gradient(90deg, color-mix(in srgb, var(--gh-cool) 40%, transparent),
        rgba(255,255,255,0.08) 38%, rgba(255,255,255,0.08) 62%, color-mix(in srgb, var(--gh-heat) 40%, transparent)); }
    .room .bar::after { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1.5px;
      margin-left: -0.75px; border-radius: 1px; background: var(--gh-text-3); }
    .room .pip { position: absolute; top: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%;
      background: color-mix(in srgb, var(--tone) var(--tc), var(--gh-text)); z-index: 1;
      box-shadow: 0 0 0 2px rgba(10,14,22,0.85), 0 0 8px -1px color-mix(in srgb, var(--tone) var(--tc), transparent); }
    .room.unavail { opacity: 0.45; }
    .room.unavail .bar, .room.unavail .dl { visibility: hidden; }

    ha-card.unavail .left, ha-card.unavail .right { opacity: 0.45; }
    ha-card.unavail .zone-ic { color: var(--gh-text-3); }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; animation: none !important; }
    }
  `;

  /* ---------------------------------------------------------------- helpers */

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    setAttrs(el, attrs);
    if (children) for (const c of [].concat(children)) if (c) el.append(c);
    return el;
  }
  function s(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    setAttrs(el, attrs);
    return el;
  }
  function setAttrs(el, attrs) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  const icon = (name) => h('ha-icon', { icon: name });

  function polar(angle, r) {
    const a = (angle * Math.PI) / 180;
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  }
  function arcPath(a0, a1, r) {
    if (a1 - a0 < 0.01) a1 = a0 + 0.01;
    const [x0, y0] = polar(a0, r);
    const [x1, y1] = polar(a1, r);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const decimalsOf = (step) => {
    const t = String(step);
    return t.includes('.') ? t.split('.')[1].length : 0;
  };
  /** Snap a value to the step grid (relative to zero, as HA does) and clamp to the range. */
  function snap(v, step, min, max) {
    const d = decimalsOf(step);
    const snapped = Math.round(v / step) * step;
    return Number(clamp(snapped, min, max).toFixed(d));
  }
  /** "71", "71.5", one decimal max for current readings. */
  function fmtTemp(v, maxDec) {
    if (!isNum(v)) return '—';
    const n = Number(v);
    const d = maxDec === undefined ? 1 : maxDec;
    const r = Number(n.toFixed(d));
    return Number.isInteger(r) ? String(r) : r.toFixed(d);
  }
  function fmtDelta(d) {
    const r = Number(d.toFixed(1));
    if (r === 0) return '0.0°';
    return `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(1)}°`;
  }

  /**
   * Room colour scale. delta = room temperature minus the setpoint (or the distance outside
   * the heat_cool band). Within +-0.5 of `scale`/4 is neutral; the tint ramps up to full strength
   * at `scale` degrees (2 by default in °F, 1 in °C).
   */
  function toneFor(delta, scale) {
    const near = scale * 0.25;
    const a = Math.abs(delta);
    if (a <= near) return { tone: 'neutral', k: 0 };
    const k = clamp((a - near) / (scale - near), 0, 1);
    return { tone: delta < 0 ? 'cool' : 'warm', k: Number(k.toFixed(3)) };
  }

  /* ------------------------------------------------------------------ card */

  class GlasshouseClimateCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._uid = `ghc${(uid += 1)}`;
      this._seen = new Map();
      this._built = false;
      this._pending = null;   // values being edited locally, not yet sent
      this._target = null;    // values sent, waiting for the device { vals, until }
      this._pendingMode = null;
      this._pendingFan = null;
      this._timer = null;
      this._sel = 'low';      // which heat_cool thumb the -/+ buttons move
      this._drag = null;
      this._renders = 0;
    }

    static getStubConfig(hass) {
      const ids = Object.keys((hass && hass.states) || {});
      const climate = ids.find((id) => id.startsWith('climate.'));
      return { entity: climate || 'climate.example' };
    }

    setConfig(config) {
      if (!config || typeof config !== 'object') throw new Error('glasshouse-climate-card: invalid configuration');
      if (typeof config.entity !== 'string' || !config.entity.startsWith('climate.')) {
        throw new Error('glasshouse-climate-card: "entity" must be a climate entity id (climate.xxx)');
      }
      for (const k of ['humidity', 'outside']) {
        if (config[k] !== undefined && (typeof config[k] !== 'string' || !config[k].includes('.'))) {
          throw new Error(`glasshouse-climate-card: "${k}" must be an entity id`);
        }
      }
      if (config.rooms !== undefined && !Array.isArray(config.rooms)) {
        throw new Error('glasshouse-climate-card: "rooms" must be a list');
      }
      const rooms = (config.rooms || []).map((r, i) => {
        const o = typeof r === 'string' ? { entity: r } : { ...r };
        if (!o.entity || typeof o.entity !== 'string' || !o.entity.includes('.')) {
          throw new Error(`glasshouse-climate-card: rooms[${i}] needs a valid "entity" id`);
        }
        return o;
      });
      if (config.scale !== undefined && !(Number(config.scale) > 0)) {
        throw new Error('glasshouse-climate-card: "scale" must be a positive number of degrees');
      }
      this._config = {
        show_modes: true, show_fan: false, ...config, rooms,
      };
      this._watch = [config.entity, config.humidity, config.outside, ...rooms.map((r) => r.entity)].filter(Boolean);
      this._built = false;
      this._seen.clear();
      this._pending = null;
      this._target = null;
      if (this._hass) this.hass = this._hass;
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config || !hass) return;
      let changed = !this._built;
      if (!this._built) this._build();
      for (const id of this._watch) {
        const st = hass.states[id];
        if (!this._seen.has(id) || st !== this._seen.get(id)) {
          this._seen.set(id, st);
          changed = true;
        }
      }
      if (!changed) return;
      this._reconcile();
      this._update();
    }

    get hass() { return this._hass; }

    getCardSize() { return this._config && this._config.rooms.length ? 9 : 7; }

    getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

    connectedCallback() { if (this._hass && this._config && this._built) this._update(); }

    disconnectedCallback() {
      if (this._timer) { clearTimeout(this._timer); this._commit(); }
    }

    /* ----------------------------------------------------------- model */

    get _st() { return this._hass && this._hass.states[this._config.entity]; }

    _unit() {
      const st = this._st;
      const u = (st && st.attributes.temperature_unit)
        || (this._hass && this._hass.config && this._hass.config.unit_system && this._hass.config.unit_system.temperature);
      return u || '°F';
    }

    _model() {
      const st = this._st;
      const unavail = !st || st.state === 'unavailable' || st.state === 'unknown';
      const a = (st && st.attributes) || {};
      const celsius = /C/.test(this._unit());
      const step = Number(a.target_temp_step) > 0 ? Number(a.target_temp_step) : (celsius ? 0.5 : 1);
      let min = isNum(a.min_temp) ? Number(a.min_temp) : (celsius ? 7 : 45);
      let max = isNum(a.max_temp) ? Number(a.max_temp) : (celsius ? 35 : 95);
      if (max <= min) max = min + step * 10;
      const mode = this._pendingMode ? this._pendingMode.mode : (unavail ? 'unavailable' : st.state);
      const dual = !unavail && isNum(a.target_temp_low) && isNum(a.target_temp_high) && !isNum(a.temperature);
      const single = !unavail && isNum(a.temperature);
      const vals = this._values(a, dual);
      return {
        st, a, unavail, celsius, step, min, max, mode, dual: dual && !!vals, single: single && !!vals,
        vals, action: a.hvac_action, current: isNum(a.current_temperature) ? Number(a.current_temperature) : null,
        gap: celsius ? 1 : 2,
      };
    }

    /** Displayed setpoint(s): local edits, then a sent target, then the entity. */
    _values(a, dual) {
      if (this._pending) return this._pending;
      if (this._target) return this._target.vals;
      if (dual) return { low: Number(a.target_temp_low), high: Number(a.target_temp_high) };
      if (isNum(a.temperature)) return { temp: Number(a.temperature) };
      return null;
    }

    /** Drop a sent target once the entity reports it (or after a timeout). */
    _reconcile() {
      const st = this._st;
      const now = Date.now();
      if (this._target) {
        const a = (st && st.attributes) || {};
        const v = this._target.vals;
        const eq = (x, y) => isNum(x) && Math.abs(Number(x) - y) < 0.01;
        const caught = 'temp' in v ? eq(a.temperature, v.temp) : (eq(a.target_temp_low, v.low) && eq(a.target_temp_high, v.high));
        if (caught || now > this._target.until || (st && st.state !== this._target.mode)) this._target = null;
      }
      if (this._pendingMode && (!st || st.state === this._pendingMode.mode || now > this._pendingMode.until)) this._pendingMode = null;
      if (this._pendingFan && (!st || st.attributes.fan_mode === this._pendingFan.mode || now > this._pendingFan.until)) this._pendingFan = null;
    }

    _frac(v, m) { return clamp((v - m.min) / (m.max - m.min), 0, 1); }
    _angle(v, m) { return START + SWEEP * this._frac(v, m); }

    /* ----------------------------------------------------------- build */

    _build() {
      const c = this._config;
      const root = this.shadowRoot;
      root.innerHTML = '';
      root.append(h('style', { text: STYLE }));
      const card = h('ha-card', { class: c.rooms.length ? 'has-rooms' : null });
      this._card = card;

      // header
      this._zoneIc = h('span', { class: 'zone-ic' }, icon(c.icon || 'mdi:thermostat'));
      this._badge = h('span', { class: 'badge', hidden: true }, icon('mdi:alert-circle-outline'));
      this._zoneIc.append(this._badge);
      this._title = h('div', { class: 'title' });
      this._sub = h('div', { class: 'sub' });
      const zone = h('button', { class: 'zone', 'aria-label': 'Thermostat details' },
        [this._zoneIc, h('span', { class: 'titles' }, [this._title, this._sub])]);
      zone.addEventListener('click', () => this._moreInfo(c.entity));
      this._chips = h('div', { class: 'chips' });
      this._humChip = h('button', { class: 'chip hum', hidden: true });
      this._humChip.addEventListener('click', () => this._moreInfo(c.humidity || c.entity));
      this._outChip = h('button', { class: 'chip out', hidden: true });
      this._outChip.addEventListener('click', () => c.outside && this._moreInfo(c.outside));
      this._chips.append(this._humChip, this._outChip);
      card.append(h('div', { class: 'head' }, [zone, this._chips]));

      // body
      const body = h('div', { class: c.rooms.length ? 'body has-rooms' : 'body' });
      const left = h('div', { class: 'left' });
      const right = h('div', { class: 'right' });
      left.append(this._buildDial());
      if (c.show_modes) { this._modes = h('div', { class: 'modes', role: 'group', 'aria-label': 'HVAC mode' }); left.append(this._modes); }
      if (c.show_fan) {
        this._fanOpts = h('div', { class: 'fan-opts', role: 'group', 'aria-label': 'Fan mode' });
        this._fan = h('div', { class: 'fan', hidden: true }, [h('span', { class: 'lbl', text: 'Fan' }), this._fanOpts]);
        left.append(this._fan);
      }
      body.append(left);
      if (c.rooms.length) {
        this._stats = h('div', { class: 'stats' });
        right.append(this._stats);
        this._range = h('span', { class: 'range' });
        right.append(h('div', { class: 'rooms-head' }, [h('span', { class: 'lbl', text: 'Rooms' }), this._range]));
        this._rooms = h('div', { class: 'rooms' });
        this._roomEls = c.rooms.map((r) => {
          const nm = h('span', { class: 'nm', text: r.name || r.entity });
          const tv = h('span', { class: 'tv' });
          const dl = h('span', { class: 'dl' });
          const pip = h('span', { class: 'pip' });
          const el = h('button', { class: 'room', 'data-entity': r.entity },
            [nm, h('span', { class: 'rv' }, [tv, dl]), h('span', { class: 'bar' }, pip)]);
          el.addEventListener('click', () => this._moreInfo(r.entity));
          this._rooms.append(el);
          return { cfg: r, el, nm, tv, dl, pip };
        });
        right.append(this._rooms);
        body.append(right);
      }
      card.append(body);
      root.append(card);
      this._modeKey = null;
      this._fanKey = null;
      this._tickKey = null;
      this._built = true;
    }

    _buildDial() {
      const id = this._uid;
      const dial = h('div', { class: 'dial' });
      this._dial = dial;
      dial.append(h('div', { class: 'glow' }), h('div', { class: 'face' }));
      const svg = s('svg', { viewBox: `0 0 ${VB} ${VB}`, 'aria-hidden': 'true' });
      this._svg = svg;
      const defs = s('defs');
      const grad = (gid) => {
        const g = s('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: CX - R, y1: 0, x2: CX + R, y2: 0 });
        g.append(s('stop', { offset: '0', style: 'stop-color: var(--gh-cool)' }),
          s('stop', { offset: '0.5', style: 'stop-color: color-mix(in srgb, var(--gh-cool) 50%, var(--gh-heat))' }),
          s('stop', { offset: '1', style: 'stop-color: var(--gh-heat)' }));
        return g;
      };
      defs.append(grad(`${id}-spec`), grad(`${id}-dual`));
      svg.append(defs);
      this._card.style.setProperty('--dual-grad', `url(#${id}-dual)`);

      svg.append(s('path', { class: 'track', d: arcPath(START, START + SWEEP, R) }));
      svg.append(s('path', { class: 'spectrum', d: arcPath(START, START + SWEEP, R), stroke: `url(#${id}-spec)` }));
      this._ticks = s('g', { class: 'ticks' });
      svg.append(this._ticks);
      this._activeArc = s('path', { class: 'active-arc' });
      svg.append(this._activeArc);
      this._curMark = s('line', { class: 'cur-mark' });
      svg.append(this._curMark);
      this._hit = s('path', { class: 'hit', d: arcPath(START, START + SWEEP, R) });
      svg.append(this._hit);
      const mkThumb = (which) => {
        const g = s('g', { class: 'thumb', 'data-thumb': which });
        g.append(s('circle', { class: 'halo', r: 15 }), s('circle', { class: 'knob', r: 9.5 }));
        svg.append(g);
        return g;
      };
      this._thumbs = { temp: mkThumb('temp'), low: mkThumb('low'), high: mkThumb('high') };
      this._thumbs.low.style.setProperty('--thumb', 'var(--gh-cool)');
      this._thumbs.high.style.setProperty('--thumb', 'var(--gh-heat)');
      dial.append(svg);

      svg.addEventListener('pointerdown', (e) => this._onDown(e));
      svg.addEventListener('pointermove', (e) => this._onMove(e));
      svg.addEventListener('pointerup', (e) => this._onUp(e));
      svg.addEventListener('pointercancel', (e) => this._onUp(e));

      // centre readout
      this._lbl = h('span', { class: 'lbl' });
      this._hero = h('div', { class: 'hero', 'aria-live': 'polite' });
      this._statusAct = h('span', { class: 'act' });
      this._status = h('span', { class: 'status' }, [h('span', { class: 'dot' }), this._statusAct]);
      this._now = h('span', { class: 'now' });
      dial.append(h('div', { class: 'center' }, [this._lbl, this._hero, this._status, this._now]));
      this._hero.addEventListener('click', (e) => {
        const n = e.target.closest && e.target.closest('.num');
        if (n && n.dataset.which) { this._sel = n.dataset.which; this._update(); }
      });

      // keyboard / screen reader sliders (visually hidden range inputs mirroring the thumbs)
      this._inputs = {};
      for (const [which, label] of [['temp', 'Target temperature'], ['low', 'Heat to (low)'], ['high', 'Cool to (high)']]) {
        const inp = h('input', { type: 'range', class: 'vh', 'aria-label': label, 'data-thumb': which });
        inp.addEventListener('input', () => { this._sel = which === 'temp' ? this._sel : which; this._setLocal(which, Number(inp.value)); });
        inp.addEventListener('focus', () => { this._thumbs[which].classList.add('focus'); if (which !== 'temp') { this._sel = which; this._update(); } });
        inp.addEventListener('blur', () => this._thumbs[which].classList.remove('focus'));
        this._inputs[which] = inp;
        dial.append(inp);
      }

      // - / + in the gap at the bottom of the arc
      this._minus = h('button', { class: 'step', 'aria-label': 'Lower target temperature' }, icon('mdi:minus'));
      this._plus = h('button', { class: 'step', 'aria-label': 'Raise target temperature' }, icon('mdi:plus'));
      this._minus.addEventListener('click', () => this._nudge(-1));
      this._plus.addEventListener('click', () => this._nudge(1));
      dial.append(h('div', { class: 'steppers' }, [this._minus, this._plus]));
      return dial;
    }

    /* ---------------------------------------------------------- update */

    _update() {
      if (!this._built) return;
      this._renders += 1;
      const c = this._config;
      const m = this._model();
      const card = this._card;
      const name = c.name || (m.st && m.st.attributes.friendly_name) || 'Thermostat';

      // tone / accent
      let tone = 'off';
      if (m.unavail) tone = 'off';
      else if (m.action === 'heating' || m.action === 'preheating') tone = 'heat';
      else if (m.action === 'cooling') tone = 'cool';
      else if (m.mode === 'heat') tone = 'heat';
      else if (m.mode === 'cool') tone = 'cool';
      else if (m.mode === 'heat_cool' || m.mode === 'auto') tone = 'dual';
      else if (m.mode === 'dry') tone = 'dry';
      else if (m.mode === 'fan_only') tone = 'fan';
      card.dataset.tone = tone;
      card.dataset.mode = m.mode;
      const active = !m.unavail && ['heating', 'preheating', 'cooling', 'drying'].includes(m.action);
      card.classList.toggle('active', active);
      card.classList.toggle('on', !m.unavail && m.mode !== 'off');
      card.classList.toggle('unavail', m.unavail);
      card.classList.toggle('dualarc', m.dual && m.mode !== 'off');

      // header
      this._title.textContent = name;
      const sub = [];
      if (m.unavail) sub.push('Unavailable');
      else {
        sub.push(m.mode === 'off' ? 'Off' : `${(MODE_META[m.mode] || { label: cap(m.mode) }).label} mode`);
        if (m.a.preset_mode && m.a.preset_mode !== 'none') sub.push(cap(m.a.preset_mode));
        if (c.show_fan === false && m.a.fan_mode && m.a.fan_mode !== 'auto' && m.mode !== 'off') sub.push(`Fan ${m.a.fan_mode}`);
      }
      this._sub.textContent = sub.join(' · ');
      this._badge.hidden = !m.unavail;
      this._updateChips(m);

      // dial
      this._updateDial(m);
      if (this._modes) this._updateModes(m);
      if (this._fan) this._updateFan(m);
      if (this._roomEls) this._updateRooms(m);
    }

    _updateChips(m) {
      const c = this._config;
      const hs = c.humidity ? this._hass.states[c.humidity] : null;
      let hum = hs && isNum(hs.state) ? Number(hs.state) : null;
      if (hum === null && !c.humidity && isNum(m.a.current_humidity)) hum = Number(m.a.current_humidity);
      this._humChip.hidden = hum === null;
      if (hum !== null) {
        this._humChip.replaceChildren(icon('mdi:water-percent'), document.createTextNode(`${Math.round(hum)}%`));
        this._humChip.setAttribute('aria-label', `Humidity ${Math.round(hum)}%`);
      }
      const os = c.outside ? this._hass.states[c.outside] : null;
      const out = os && isNum(os.state) ? Number(os.state) : null;
      this._outChip.hidden = out === null;
      if (out !== null) {
        this._outChip.replaceChildren(icon('mdi:sun-thermometer-outline'), h('span', { class: 'k', text: 'Outside' }),
          document.createTextNode(`${fmtTemp(out, 0)}°`));
        this._outChip.setAttribute('aria-label', `Outside ${fmtTemp(out, 1)}°`);
      }
    }

    _updateTicks(m) {
      const key = `${m.min}|${m.max}`;
      if (key === this._tickKey) return;
      this._tickKey = key;
      const span = m.max - m.min;
      const stepTick = [0.5, 1, 2, 5, 10].find((t) => span / t <= 60) || 10;
      const major = stepTick <= 1 ? 5 : stepTick * 5;
      const g = this._ticks;
      g.replaceChildren();
      this._tickEls = [];
      for (let v = Math.ceil(m.min / stepTick) * stepTick; v <= m.max + 1e-9; v += stepTick) {
        const val = Number(v.toFixed(2));
        const isMajor = Math.abs(val / major - Math.round(val / major)) < 1e-6;
        const ang = this._angle(val, m);
        const [x0, y0] = polar(ang, R + 13);
        const [x1, y1] = polar(ang, R + (isMajor ? 19 : 16.5));
        const t = s('line', { class: isMajor ? 'tick major' : 'tick', x1: x0.toFixed(2), y1: y0.toFixed(2), x2: x1.toFixed(2), y2: y1.toFixed(2) });
        t._v = val;
        g.append(t);
        this._tickEls.push(t);
      }
      // end labels
      for (const [v, a] of [[m.min, START], [m.max, START + SWEEP]]) {
        const [x, y] = polar(a, R + 4);
        const lbl = s('text', { class: 'scale-lbl', x: x.toFixed(1), y: (y + 22).toFixed(1), 'text-anchor': 'middle' });
        lbl.textContent = `${fmtTemp(v, 1)}°`;
        g.append(lbl);
      }
    }

    _updateDial(m) {
      this._updateTicks(m);
      const v = m.vals;
      const showTargets = !m.unavail && (m.single || m.dual) && m.mode !== 'off';
      let a0 = null, a1 = null;
      if (showTargets && m.single) {
        const at = this._angle(v.temp, m);
        if (m.mode === 'cool' || (m.mode !== 'heat' && m.action === 'cooling')) { a0 = at; a1 = START + SWEEP; }
        else { a0 = START; a1 = at; }
      } else if (showTargets && m.dual) {
        a0 = this._angle(v.low, m); a1 = this._angle(v.high, m);
      }
      if (a0 !== null) { this._activeArc.setAttribute('d', arcPath(a0, a1, R)); this._activeArc.style.display = ''; }
      else this._activeArc.style.display = 'none';
      for (const t of this._tickEls || []) {
        const ta = this._angle(t._v, m);
        t.classList.toggle('in', a0 !== null && ta >= a0 - 0.01 && ta <= a1 + 0.01);
      }

      // thumbs
      const place = (g, val) => {
        const [x, y] = polar(this._angle(val, m), R);
        g.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
        g.style.display = '';
      };
      for (const k of ['temp', 'low', 'high']) this._thumbs[k].style.display = 'none';
      if (showTargets && m.single) place(this._thumbs.temp, v.temp);
      if (showTargets && m.dual) {
        place(this._thumbs.low, v.low); place(this._thumbs.high, v.high);
        this._thumbs.low.classList.toggle('sel', this._sel === 'low');
        this._thumbs.high.classList.toggle('sel', this._sel === 'high');
      }

      // current temperature mark on the track
      if (m.current !== null && !m.unavail) {
        const ca = this._angle(m.current, m);
        const [x0, y0] = polar(ca, R - 9);
        const [x1, y1] = polar(ca, R + 9);
        setAttrs(this._curMark, { x1: x0.toFixed(2), y1: y0.toFixed(2), x2: x1.toFixed(2), y2: y1.toFixed(2) });
        this._curMark.style.display = '';
      } else this._curMark.style.display = 'none';

      // hidden range inputs
      for (const k of ['temp', 'low', 'high']) {
        const inp = this._inputs[k];
        const show = showTargets && (k === 'temp' ? m.single : m.dual);
        inp.hidden = !show;
        inp.disabled = !show;
        if (!show) continue;
        inp.min = m.min; inp.max = m.max; inp.step = m.step;
        if (k === 'low') inp.max = Number((v.high - m.gap).toFixed(2));
        if (k === 'high') inp.min = Number((v.low + m.gap).toFixed(2));
        if (this.shadowRoot.activeElement !== inp || !this._pending) inp.value = String(v[k]);
      }

      // centre
      const unit = '°';
      const numEl = (val, which) => {
        const d = decimalsOf(m.step);
        const str = Number(val).toFixed(d);
        const [ip, fp] = str.split('.');
        const showFrac = fp && Number(fp) !== 0;
        const el = h('span', { class: `num${which ? ` ${which === 'low' ? 'lo' : 'hi'}` : ''}` }, [
          h('span', { class: 'main', text: ip }),
          showFrac ? h('span', { class: 'frac', text: `.${fp}` }) : null,
          h('span', { class: 'deg', text: unit }),
        ]);
        if (which) {
          el.dataset.which = which;
          el.classList.toggle('sel', this._sel === which);
        }
        return el;
      };
      this._hero.classList.toggle('dual', showTargets && m.dual);
      if (m.unavail) {
        this._lbl.textContent = 'Thermostat';
        this._hero.replaceChildren(h('span', { class: 'main', text: '—' }));
      } else if (showTargets && m.single) {
        this._lbl.textContent = m.mode === 'cool' ? 'Cool to' : m.mode === 'heat' ? 'Heat to' : 'Target';
        this._hero.replaceChildren(numEl(v.temp));
      } else if (showTargets && m.dual) {
        this._lbl.textContent = 'Keep between';
        this._hero.replaceChildren(numEl(v.low, 'low'), h('span', { class: 'sep', text: '–' }), numEl(v.high, 'high'));
      } else {
        this._lbl.textContent = 'Indoor';
        this._hero.replaceChildren(m.current !== null ? numEl(Number(fmtTemp(m.current, decimalsOf(m.step) || 0))) : h('span', { class: 'main', text: '—' }));
      }

      let act;
      if (m.unavail) act = 'Unavailable';
      else if (m.action) act = ACTION_TEXT[m.action] || cap(m.action);
      else act = m.mode === 'off' ? 'Off' : 'Idle';
      if (m.mode === 'off' && !m.unavail) act = 'Off';
      this._statusAct.textContent = act;
      const nowShown = showTargets && m.current !== null;
      this._now.hidden = !nowShown;
      if (nowShown) this._now.replaceChildren(document.createTextNode('Now '), h('b', { text: `${fmtTemp(m.current, 1)}°` }));

      const canStep = showTargets && !m.unavail;
      this._minus.disabled = !canStep;
      this._plus.disabled = !canStep;
      this._minus.hidden = this._plus.hidden = !showTargets && !m.unavail;
      if (canStep) {
        const which = m.dual ? this._sel : 'temp';
        const cur = v[which];
        const lo = which === 'high' ? v.low + m.gap : m.min;
        const hi = which === 'low' ? v.high - m.gap : m.max;
        this._minus.disabled = cur <= lo + 1e-9;
        this._plus.disabled = cur >= hi - 1e-9;
        const nm = which === 'low' ? 'heat-to' : which === 'high' ? 'cool-to' : 'target';
        this._minus.setAttribute('aria-label', `Lower ${nm} temperature`);
        this._plus.setAttribute('aria-label', `Raise ${nm} temperature`);
      }
    }

    _updateModes(m) {
      const modes = (m.a.hvac_modes || []).slice().sort((x, y) => {
        const ix = MODE_ORDER.indexOf(x), iy = MODE_ORDER.indexOf(y);
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
      });
      const key = modes.join(',');
      if (key !== this._modeKey) {
        this._modeKey = key;
        this._modeBtns = new Map();
        this._modes.replaceChildren();
        this._modes.classList.toggle('many', modes.length > 4);
        for (const md of modes) {
          const meta = MODE_META[md] || { icon: 'mdi:thermostat', label: cap(md) };
          const b = h('button', { class: 'mode', 'data-mode': md, 'aria-label': meta.label, title: meta.label },
            [icon(meta.icon), h('span', { class: 't', text: meta.label })]);
          b.addEventListener('click', () => this._setMode(md));
          this._modes.append(b);
          this._modeBtns.set(md, b);
        }
      }
      this._modes.hidden = !modes.length;
      for (const [md, b] of this._modeBtns) {
        b.setAttribute('aria-pressed', String(!m.unavail && m.mode === md));
        b.disabled = m.unavail;
      }
    }

    _updateFan(m) {
      const fm = m.a.fan_modes || [];
      this._fan.hidden = !fm.length;
      const key = fm.join(',');
      if (key !== this._fanKey) {
        this._fanKey = key;
        this._fanBtns = new Map();
        this._fanOpts.replaceChildren();
        for (const f of fm) {
          const b = h('button', { class: 'fopt', 'data-fan': f, 'aria-label': `Fan ${f}` },
            [icon(FAN_ICON[String(f).toLowerCase()] || 'mdi:fan'), document.createTextNode(cap(String(f)))]);
          b.addEventListener('click', () => this._setFan(f));
          this._fanOpts.append(b);
          this._fanBtns.set(f, b);
        }
      }
      const cur = this._pendingFan ? this._pendingFan.mode : m.a.fan_mode;
      for (const [f, b] of this._fanBtns) {
        b.setAttribute('aria-pressed', String(!m.unavail && cur === f));
        b.disabled = m.unavail;
      }
    }

    _updateRooms(m) {
      const scale = Number(this._config.scale) > 0 ? Number(this._config.scale) : (m.celsius ? 1 : 2);
      const v = m.vals;
      const hasTarget = !m.unavail && m.mode !== 'off' && (m.single || m.dual);
      const ref = hasTarget ? null : m.current;
      const temps = [];
      for (const r of this._roomEls) {
        const st = this._hass.states[r.cfg.entity];
        const ok = st && isNum(st.state);
        r.el.classList.toggle('unavail', !ok);
        if (!r.cfg.name && st && st.attributes.friendly_name) r.nm.textContent = st.attributes.friendly_name;
        if (!ok) {
          r.tv.replaceChildren(document.createTextNode('—'));
          r.dl.textContent = '';
          r.el.dataset.tone = 'neutral';
          r.el.style.setProperty('--tp', '0%'); r.el.style.setProperty('--tpn', '0'); r.el.style.setProperty('--tc', '0%');
          r.el.setAttribute('aria-label', `${r.nm.textContent}: unavailable`);
          continue;
        }
        const t = Number(st.state);
        temps.push(t);
        let delta = null;
        if (hasTarget && m.single) delta = t - v.temp;
        else if (hasTarget && m.dual) delta = t < v.low ? t - v.low : t > v.high ? t - v.high : 0;
        else if (ref !== null) delta = t - ref;
        const { tone, k } = delta === null ? { tone: 'neutral', k: 0 } : toneFor(delta, scale);
        r.el.dataset.tone = tone;
        r.el.dataset.k = String(k);
        r.el.style.setProperty('--tone', tone === 'cool' ? 'var(--gh-cool)' : tone === 'warm' ? 'var(--gh-heat)' : 'var(--gh-neutral)');
        r.el.style.setProperty('--tp', `${Math.round(k * 22)}%`);
        r.el.style.setProperty('--tpn', String(Math.round(k * 40)));
        r.el.style.setProperty('--tc', `${Math.round(k * 70)}%`);
        r.tv.replaceChildren(document.createTextNode(fmtTemp(t, 1)), h('small', { text: '°' }));
        r.dl.textContent = delta === null ? '' : (hasTarget && m.dual && delta === 0 ? 'In range' : fmtDelta(delta));
        r.dl.hidden = delta === null;
        const pos = delta === null ? 50 : clamp(50 + (delta / (scale * 2)) * 50, 4, 96);
        r.pip.style.left = `${pos}%`;
        const vs = hasTarget ? (m.dual ? 'the range' : 'target') : 'zone';
        r.el.setAttribute('aria-label', `${r.nm.textContent}: ${fmtTemp(t, 1)}°${delta === null ? '' : `, ${fmtDelta(delta)} vs ${vs}`}`);
      }
      if (temps.length >= 2) {
        const lo = Math.min(...temps), hi = Math.max(...temps);
        this._range.textContent = `${fmtTemp(lo, 1)}° – ${fmtTemp(hi, 1)}°`;
      } else this._range.textContent = '';
      this._updateStats(m, temps);
    }

    _updateStats(m, temps) {
      const c = this._config;
      const cells = [];
      const deg = (v, u) => [document.createTextNode(u === '%' ? String(Math.round(v)) : Number(v).toFixed(1)), h('small', { text: u || '°' })];
      cells.push(['Indoor', m.current !== null && !m.unavail ? deg(m.current) : [document.createTextNode('—')]]);
      if (temps.length) {
        const avg = temps.reduce((x, y) => x + y, 0) / temps.length;
        cells.push(['Rooms avg', deg(avg)]);
      }
      if (temps.length >= 2) {
        const spread = Math.max(...temps) - Math.min(...temps);
        cells.push(['Spread', deg(spread)]);
      }
      const os = c.outside ? this._hass.states[c.outside] : null;
      if (os && isNum(os.state)) cells.push(['Outside', deg(Number(os.state))]);
      const hs = c.humidity ? this._hass.states[c.humidity] : null;
      const hum = hs && isNum(hs.state) ? Number(hs.state) : (!c.humidity && isNum(m.a.current_humidity) ? Number(m.a.current_humidity) : null);
      if (hum !== null) cells.push(['Humidity', deg(hum, '%')]);
      this._stats.replaceChildren(...cells.map(([k, v], i) => h('div', { class: 'stat' }, [
        h('span', { class: 'lbl', text: k }), h('span', { class: i === 0 && this._card.classList.contains('active') ? 'v acc' : 'v' }, v),
      ])));
    }

    /* --------------------------------------------------------- actions */

    _moreInfo(entityId) {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
    }

    _haptic() {
      this.dispatchEvent(new CustomEvent('haptic', { detail: 'light', bubbles: true, composed: true }));
    }

    _setMode(mode) {
      const m = this._model();
      if (m.unavail || m.mode === mode) return;
      if (this._timer) { clearTimeout(this._timer); this._commit(); }
      this._pending = null;
      this._target = null;
      this._pendingMode = { mode, until: Date.now() + MODE_TTL };
      this._haptic();
      this._hass.callService('climate', 'set_hvac_mode', { entity_id: this._config.entity, hvac_mode: mode });
      this._update();
    }

    _setFan(f) {
      const m = this._model();
      if (m.unavail) return;
      this._pendingFan = { mode: f, until: Date.now() + MODE_TTL };
      this._haptic();
      this._hass.callService('climate', 'set_fan_mode', { entity_id: this._config.entity, fan_mode: f });
      this._update();
    }

    /** Change one setpoint locally and (re)start the debounce timer. */
    _setLocal(which, value) {
      const m = this._model();
      if (m.unavail || !m.vals || m.mode === 'off') return;
      const vals = { ...m.vals };
      let v = snap(value, m.step, m.min, m.max);
      if (which === 'low') v = Math.min(v, snap(vals.high - m.gap, m.step, m.min, m.max));
      if (which === 'high') v = Math.max(v, snap(vals.low + m.gap, m.step, m.min, m.max));
      if (vals[which] === v && this._pending) return;
      vals[which] = v;
      this._pending = vals;
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(() => this._commit(), DEBOUNCE_MS);
      this._update();
    }

    _commit() {
      this._timer = null;
      const vals = this._pending;
      if (!vals || !this._hass) return;
      this._pending = null;
      const st = this._st;
      this._target = { vals, until: Date.now() + TARGET_TTL, mode: st ? st.state : undefined };
      const data = { entity_id: this._config.entity };
      if ('temp' in vals) data.temperature = vals.temp;
      else { data.target_temp_low = vals.low; data.target_temp_high = vals.high; }
      this._hass.callService('climate', 'set_temperature', data);
      this._update();
    }

    _nudge(dir) {
      const m = this._model();
      if (m.unavail || !m.vals) return;
      const which = m.dual ? this._sel : 'temp';
      this._setLocal(which, m.vals[which] + dir * m.step);
    }

    /* ------------------------------------------------------------ drag */

    _pointToSvg(e) {
      const rect = this._svg.getBoundingClientRect();
      if (!rect.width) return null;
      return [((e.clientX - rect.left) / rect.width) * VB, ((e.clientY - rect.top) / rect.height) * VB];
    }

    /** Fraction 0..1 along the arc for a point; points in the bottom gap stick to the nearer end. */
    _fracAt(x, y, last) {
      let ang = (Math.atan2(y - CY, x - CX) * 180) / Math.PI;
      if (ang < 0) ang += 360;
      let rel = ang - START;
      if (rel < 0) rel += 360;
      if (rel > SWEEP) {
        if (last !== undefined && last !== null) return last > 0.5 ? 1 : 0;
        return rel > SWEEP + (360 - SWEEP) / 2 ? 0 : 1;
      }
      return rel / SWEEP;
    }

    _onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      const m = this._model();
      if (m.unavail || !m.vals || m.mode === 'off') return;
      const p = this._pointToSvg(e);
      if (!p) return;
      const dist = Math.hypot(p[0] - CX, p[1] - CY);
      if (dist < R - 32 || dist > R + 32) return;
      const f = this._fracAt(p[0], p[1]);
      let which = 'temp';
      if (m.dual) {
        const fl = this._frac(m.vals.low, m), fh = this._frac(m.vals.high, m);
        which = Math.abs(f - fl) <= Math.abs(f - fh) ? 'low' : 'high';
        if (Math.abs(f - fl) === Math.abs(f - fh)) which = f < fl ? 'low' : 'high';
        this._sel = which;
      } else if (!m.single) return;
      e.preventDefault();
      this._drag = { which, id: e.pointerId, last: f };
      try { this._svg.setPointerCapture(e.pointerId); } catch (_) { /* not supported */ }
      this._thumbs[which].classList.add('drag');
      this._dragTo(f, m);
    }

    _onMove(e) {
      if (!this._drag) return;
      const p = this._pointToSvg(e);
      if (!p) return;
      e.preventDefault();
      const f = this._fracAt(p[0], p[1], this._drag.last);
      // Never jump across the gap in one move.
      if (Math.abs(f - this._drag.last) > 0.6) return;
      this._drag.last = f;
      this._dragTo(f, this._model());
    }

    _onUp(e) {
      if (!this._drag) return;
      try { this._svg.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      this._thumbs[this._drag.which].classList.remove('drag');
      this._drag = null;
    }

    _dragTo(f, m) {
      this._setLocal(this._drag.which, m.min + f * (m.max - m.min));
    }
  }

  if (!customElements.get(TAG)) {
    customElements.define(TAG, GlasshouseClimateCard);
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: TAG,
      name: 'Glasshouse Climate Card',
      description: 'A dial thermostat for one HVAC zone, with its rooms beside it.',
      preview: true,
      documentationURL: 'https://github.com/petergCA/glasshouse-climate-card',
    });
    console.info(
      `%c GLASSHOUSE-CLIMATE-CARD %c v${VERSION} `,
      'color:#0a0f18;background:#ff7a59;font-weight:700;border-radius:4px 0 0 4px;padding:2px 4px',
      'color:#e9eef6;background:#1b2333;font-weight:600;border-radius:0 4px 4px 0;padding:2px 4px',
    );
  }

  // exposed for tests
  GlasshouseClimateCard._snap = snap;
  GlasshouseClimateCard._toneFor = toneFor;
})();
