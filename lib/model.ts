// Airdrop Finder — the token radar's scoring model.
//
// The board ranks every pre-token protocol in the sealed snapshot by an implied token value, and the
// dashboard explains each rank. Implied value follows only from the snapshot's own figures, as four
// factors the page shows separately:
//
//   size      = SIZE_MULTIPLE of tvl_usd, banded by TVL (a bigger protocol launches bigger, but on a
//               declining multiple: the floor's $50M+ protocols launch on a smaller share of TVL than
//               a $10M protocol that just earned its first users)
//   growth    = 1 + (clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) / 100) x GROWTH_WEIGHT
//   window    = the launch-window curve: 0.35 at day 0, a peak of 1.0 between WINDOW_OPEN and
//               WINDOW_PEAK_END days of age, then a decay toward WINDOW_FLOOR by WINDOW_DECAY_DAYS
//               (a protocol that has run tokenless for the typical airdrop window is the one most
//               likely to launch, and most likely to have points worth farming; a nine-day-old
//               protocol still has to earn its users, one four years old has already chosen not to)
//   quality   = a small chain-and-category correction: a protocol the snapshot puts on an L1/L2 of
//               scale, in a category where tokens actually get issued, is the likelier launch
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// recomputes the same arithmetic from the row's own model block.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard and echoed on every row. */
export interface ModelConstants {
  size_bands: { min_tvl: number; multiple: number }[];
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  window_open: number;
  window_peak_end: number;
  window_decay_days: number;
  window_floor: number;
  window_start: number;
  unknown_age_days: number;
  quality_chains: string[];
  quality_categories: string[];
  quality_max: number;
}

export const MODEL: ModelConstants = {
  // Size bands, most specific first: TVL at or above min_tvl takes the multiple.
  size_bands: [
    { min_tvl: 50_000_000_000, multiple: 0.04 },
    { min_tvl: 10_000_000_000, multiple: 0.07 },
    { min_tvl: 2_000_000_000, multiple: 0.12 },
    { min_tvl: 500_000_000, multiple: 0.18 },
    { min_tvl: 100_000_000, multiple: 0.25 },
    { min_tvl: 25_000_000, multiple: 0.32 },
    { min_tvl: 0, multiple: 0.38 },
  ],
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  // The launch window, in days of recorded age: peak between open and peak_end, then decay.
  window_open: 90,
  window_peak_end: 540,
  window_decay_days: 1095,
  window_floor: 0.3,
  window_start: 0.35,
  unknown_age_days: 300,
  // Quality: chains of scale, categories where a token is the common ending. Each hit adds its
  // fraction, capped at QUALITY_MAX; the multiplier is 1 + quality. A category outside the list
  // (an exchange, a staked product, a custodian) takes the base, because a token there is rare.
  quality_chains: ['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Sui', 'Aptos', 'Hyperliquid'],
  quality_categories: [
    'Dexs',
    'Lending',
    'Perpetuals',
    'Derivatives',
    'Yield',
    'Yield Aggregator',
    'CDP',
    'Liquid Staking',
    'Liquid Restaking',
    'Bridge',
    'Canonical Bridge',
    'Launchpad',
    'Insurance',
    'Prediction',
    'RWA',
    'Basis Trading',
    'Restaking',
  ],
  quality_max: 0.25,
};

/** Categories the quality factor holds down rather than up: a token there is the rare ending. */
export const QUALITY_EXCLUDED = ['CEX', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Bridge', 'Canonical Bridge', 'CEX Spot', 'Wrapped', 'Staking Pool'];

/** The provenance discount: a wrapped, staked, bridged or exchange product of an asset that already
 *  trades carries a small share of its TVL into its own implied value, because the value already
 *  accrues to the parent token. The same rule the watchlist applies; the board keeps the rows and
 *  prices them honestly instead of dropping them. */
export const DERIVATIVE_DISCOUNT = 0.12;

/** The model's version label: the dashboard names it and every row echoes it. */
export const MODEL_VERSION = 'airdrop-finder-1';

/** The live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_band: string;
    size_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    window_multiplier: number;
    window_label: string;
    quality_multiplier: number;
    age_days: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  wl: boolean;
  size_multiple: number;
  growth_multiplier: number;
  window_multiplier: number;
  window_label: string;
  quality_multiplier: number;
  provenance_multiplier: number;
}

/** Everything the dashboard renders, written beside the dashboard as data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  signal_counts: { window: number; watchlist: number; early: number };
  rows: RadarRow[];
  live: LiveRow[];
}

/** A live-token protocol's compact row for the Live view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export class SnapshotError extends Error {}

const DAY = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A protocol with no recorded token: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A rankable pre-token protocol: one the snapshot gives a TVL for. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && Number.isFinite(p.tvl_usd) && p.tvl_usd > 0;
}

/** Days since the protocol was first tracked, from the snapshot's own date; null when unrecorded. */
export function ageDaysOf(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(listed) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((now - listed) / DAY));
}

/** The size band a TVL falls in, and its multiple. */
export function sizeBand(tvl: number, model: ModelConstants): { label: string; multiple: number } {
  for (const band of model.size_bands) {
    if (tvl >= band.min_tvl) {
      const label = band.min_tvl === 0 ? 'under $25M' : `$${Math.round(band.min_tvl / 1e6)}M+ TVL`;
      return { label, multiple: band.multiple };
    }
  }
  return { label: 'under $25M', multiple: model.size_bands[model.size_bands.length - 1]!.multiple };
}

/** The clamped seven-day growth, in per cent, or 0 where the snapshot records none. */
export function growthPctOf(p: SnapshotProtocol, model: ModelConstants): number {
  if (p.change_7d === null || !Number.isFinite(p.change_7d)) return 0;
  return Math.min(model.growth_cap, Math.max(model.growth_floor, p.change_7d));
}

/** The launch-window multiplier and its label, from the protocol's recorded age. */
export function windowOf(age: number | null, model: ModelConstants): { value: number; label: string } {
  const days = age === null ? model.unknown_age_days : Math.min(Math.max(age, 0), model.window_decay_days);
  let value: number;
  let label: string;
  if (days < model.window_open) {
    value = model.window_start + (days / model.window_open) * (1 - model.window_start);
    label = 'building users';
  } else if (days <= model.window_peak_end) {
    value = 1;
    label = 'in the launch window';
  } else {
    const over = days - model.window_peak_end;
    value = Math.max(model.window_floor, 1 - (over / model.window_decay_days) * (1 - model.window_floor));
    label = 'long-running, late window';
  }
  return { value: round4(value), label };
}

/** The quality multiplier, from chains and category the snapshot itself records. A protocol whose
 *  category is on the excluded list (an exchange, a staked or bridged product) is held at 1: a token
 *  there is the rare ending, not the common one. */
export function qualityOf(p: SnapshotProtocol, model: ModelConstants): { value: number; chainHits: number; categoryHit: boolean } {
  let chainHits = 0;
  for (const chain of p.chains) if (model.quality_chains.includes(chain)) chainHits += 1;
  const categoryHit = p.category !== null && model.quality_categories.includes(p.category) && !QUALITY_EXCLUDED.includes(p.category);
  const excluded = p.category !== null && QUALITY_EXCLUDED.includes(p.category);
  const raw = excluded ? 0 : chainHits * 0.05 + (categoryHit ? 0.1 : 0);
  const value = Math.min(model.quality_max, raw);
  return { value: round4(1 + value), chainHits, categoryHit };
}

/** The implied value's four factors and their product, in whole dollars. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL) {
  const band = sizeBand(p.tvl_usd, model);
  const growthPct = growthPctOf(p, model);
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const age = ageDaysOf(p, asOf);
  const window = windowOf(age, model);
  const quality = qualityOf(p, model);
  const derivative = isDerivative(p);
  const provenance = derivative ? DERIVATIVE_DISCOUNT : 1;
  const implied = Math.max(1, Math.round(p.tvl_usd * band.multiple * growthMult * window.value * quality.value * provenance));
  return { band, growthPct, growthMult, window, quality, age, derivative, implied };
}

/** A wrapped, staked, bridged or exchange product of an asset that already trades: the watchlist's
 *  own exclusion rule, applied as a price rather than a filter. */
export function isDerivative(p: SnapshotProtocol): boolean {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name.toLowerCase();
  return (
    c.includes('bridge') ||
    c.includes('cex') ||
    c.includes('liquid staking') ||
    c.includes('liquid restaking') ||
    c.includes('restaked') ||
    c.includes('wrapped') ||
    c.includes('staking pool') ||
    /\b(wrapped|staked|staking)\b/.test(n)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The board: every rankable pre-token protocol, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      size_band: s.band.label,
      size_multiple: s.band.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      window_multiplier: s.window.value,
      window_label: s.window.label,
      quality_multiplier: s.quality.value,
      provenance_multiplier: s.derivative ? DERIVATIVE_DISCOUNT : 1,
      age_days: s.age === null ? model.unknown_age_days : s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Rough gas for one action on a chain, from the chain name the snapshot records. */
function gasFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 12;
  if (c === 'solana' || c === 'sui' || c === 'aptos') return 1;
  if (c.includes('zksync') || c.includes('starknet')) return 4;
  if (['base', 'arbitrum', 'optimism', 'polygon', 'scroll', 'linea', 'blast', 'mantle'].some((l2) => c.includes(l2))) return 2;
  return 5;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: the younger one gets the longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 75;
  if (age < 365) return 60;
  if (age < 720) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('cex')) return `Trade at least $${capital} of spot volume a week on ${name} with your main account while it runs no points page, so a late one counts you from day one.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it, then repay.`;
  if (c.includes('dex')) return `Swap on ${name} on ${chain} weekly, and provide $${capital} of liquidity to its largest pool.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} as margin on ${name}, open one small position each week and close it in profit or loss.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and leave it to compound.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's native asset through ${name} and keep the receipt token in the same wallet.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, use the funds there, and bridge back after a week.`;
  if (c.includes('launchpad') || c.includes('allocator') || c.includes('curator')) return `Deposit $${capital} into a ${name} vault or allocation on ${chain} and keep the shares.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in its most liquid market each week.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and renew it once before the term ends.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it across at least two monthly cycles.`;
  if (c.includes('stable')) return `Mint and redeem $${capital} of the stable asset through ${name} once, then hold the position.`;
  if (c.includes('basis')) return `Open the long-short pair $${capital} of size on ${name} and roll it once.`;
  if (c.includes('liquid')) return `Restake $${capital} of the staked asset through ${name} and keep the liquid receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six concrete steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names. The
 * watchlist's own exclusions apply first: a bridge, a staked product of a token that trades, an
 * exchange, or a wrapped asset is a place to route capital, not a fresh token to farm.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const c = (p.category ?? '').toLowerCase();
  const n = p.name.toLowerCase();
  const derivative = c.includes('bridge') || c.includes('cex') || c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restaked') || /\b(wrapped|staked|staking)\b/.test(n);
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet for this farm, fund it with $${capital + Math.max(4, gas + 2)} ($${capital} of position money plus gas), and keep its seed offline.`,
      cost: `about $${gas} of gas to get started`,
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital`,
      time: '15 minutes',
    },
    {
      text: `Make one qualifying action a week for six weeks: a deposit, a swap, a borrow or a vote, so the wallet shows repeated intent.`,
      cost: `about $${Math.max(1, Math.round(gas / 3))} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position at least ${hold} days. ${age === null ? 'The snapshot does not say when this protocol started, so assume it is early and be patient.' : `It has been tokenless for ${Math.round(age)} days, so ${age >= 90 && age <= 540 ? 'the points era is at its likeliest now' : 'give the position a full quarter before you judge it'}.`}`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Watch ${p.name} (${p.slug}) on the radar board and the protocol's own announcements for a points page or token vote; never pay anyone to claim an airdrop.`,
      cost: 'no fee to watch, and never pay to claim',
      time: '5 minutes a week',
    },
    {
      text: `Log the wallet, the dates and every transaction, so you can prove the history when the token lands or unwind cleanly if it never does.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  if (derivative) {
    steps.splice(1, 0, {
      text: `This is a wrapped, staked, bridged or exchange product of an asset that already trades: it may never issue a token of its own, so treat the activity as a bet on a future points program and cap the capital you park here.`,
      cost: 'no extra cost, it shapes the position size',
      time: 'read once, 2 minutes',
    });
  }
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    wl: watchlist.has(row.slug),
    size_multiple: row.model.size_multiple,
    growth_multiplier: row.model.growth_multiplier,
    window_multiplier: row.model.window_multiplier,
    window_label: row.model.window_label,
    quality_multiplier: row.model.quality_multiplier,
    provenance_multiplier: row.model.provenance_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: live.length,
    signal_counts: {
      window: board.filter((r) => r.model.window_label === 'in the launch window').length,
      watchlist: board.filter((r) => watchlist.has(r.slug)).length,
      early: board.filter((r) => !watchlist.has(r.slug)).length,
    },
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The board out of a file's text, refused unless it is the shape the gate scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || typeof o.floor_usd !== 'number' || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) {
    throw new SnapshotError('snapshot.json is missing one of as_of, floor_usd, protocols, watchlist');
  }
  return {
    as_of: o.as_of,
    source: typeof o.source === 'string' ? o.source : 'unknown',
    floor_usd: o.floor_usd,
    protocols: o.protocols as SnapshotProtocol[],
    watchlist: o.watchlist as string[],
  };
}

/** The gate's own board audit: null when the board passes, else why it fails. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
