// Airdrop Finder — the token radar's pricing model.
//
// The board ranks every pre-token protocol in the sealed snapshot by an implied token value, and the
// dashboard shows where each number comes from. The value is a comps multiple fitted from the
// snapshot itself: the protocols whose token already trades record both a market cap and a TVL, so
// market cap / TVL is the ratio the market actually paid, and its median in a TVL band is what a
// launch in that band is worth per dollar of TVL.
//
//   implied = tvl_usd × comps(band of tvl) × growth × age × quality × provenance
//
//   comps      the fitted median mcap/TVL of the snapshot's own live-token protocols in that band,
//              with the sample size and quartiles carried beside it. A band with fewer than
//              MIN_BAND_SAMPLES comps borrows the nearest band that has enough, and says so.
//   growth     1 + (clamp(change_7d, -60, 120) / 100) × GROWTH_WEIGHT: a protocol whose TVL is rising
//              is gaining the users a launch is paid for.
//   age        the launch-window adjustment, shrunk toward 1 by its own sample size, so a band with
//              four protocols barely moves the price and one with fifty moves it fully.
//   quality    a small correction for chains of scale and categories where a token is the common
//              ending; a wrapped, staked, bridged or exchange product gets nothing.
//   provenance a wrapped, staked, bridged or exchange product of an asset that already trades carries
//              DERIVATIVE_DISCOUNT of its TVL into a token of its own: the value already accrues to
//              the parent. The same rule the watchlist applies, priced instead of filtered.
//
// No protocol name is ever special-cased: the same function scores every row, and every row carries
// its own factors so the page can multiply them back and check the board's number.

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

const DAY = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The TVL bands the comps are fitted in: a launch's share of TVL falls as the protocol grows. */
export const BANDS: { min_tvl: number; max_tvl: number; label: string }[] = [
  { min_tvl: 5_000_000, max_tvl: 25_000_000, label: '$5–25M TVL' },
  { min_tvl: 25_000_000, max_tvl: 100_000_000, label: '$25–100M TVL' },
  { min_tvl: 100_000_000, max_tvl: 500_000_000, label: '$100–500M TVL' },
  { min_tvl: 500_000_000, max_tvl: 2_000_000_000, label: '$500M–2B TVL' },
  { min_tvl: 2_000_000_000, max_tvl: 10_000_000_000, label: '$2–10B TVL' },
  { min_tvl: 10_000_000_000, max_tvl: Infinity, label: '$10B+ TVL' },
];

/** The band a TVL falls in, or -1 when it is under the snapshot's smallest comp. */
export function bandIndex(tvl: number): number {
  for (let i = 0; i < BANDS.length; i += 1) if (tvl >= BANDS[i]!.min_tvl && tvl < BANDS[i]!.max_tvl) return i;
  return -1;
}

/** A band's fitted multiple, with the evidence behind it. */
export interface CompsBand {
  label: string;
  multiple: number;
  n: number;
  p25: number;
  p75: number;
  /** The band this one borrowed its multiple from, when its own sample was too small. */
  borrowed_from: string | null;
}

/** How many live-token protocols a band needs before its own median is trusted. */
export const MIN_BAND_SAMPLES = 3;

/** The age bands, for the launch-window adjustment. */
const AGE_BANDS: { lo: number; hi: number; label: string }[] = [
  { lo: 0, hi: 180, label: 'under 6 months' },
  { lo: 180, hi: 365, label: '6–12 months' },
  { lo: 365, hi: 730, label: '1–2 years' },
  { lo: 730, hi: 1460, label: '2–4 years' },
  { lo: 1460, hi: Infinity, label: '4 years and older' },
];

/** How hard an age band's own median is allowed to pull, before its sample size shrinks it. */
export const AGE_SHRINKAGE_K = 10;

/** The growth factor's weight and clamp: a prior, stated on the page, not fitted. */
export const GROWTH_WEIGHT = 0.5;
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;

/** Chains of scale and the categories where a token is the common ending. */
export const QUALITY_CHAINS = ['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Sui', 'Aptos', 'Hyperliquid'];
export const QUALITY_CATEGORIES = [
  'Dexs',
  'Lending',
  'Perpetuals',
  'Derivatives',
  'Yield',
  'Yield Aggregator',
  'CDP',
  'Launchpad',
  'Insurance',
  'Prediction',
  'RWA',
  'Basis Trading',
  'Restaking',
];
/** A token there is the rare ending: the quality factor holds these at zero. */
export const QUALITY_EXCLUDED = ['CEX', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Bridge', 'Canonical Bridge', 'Staking Pool'];
export const QUALITY_MAX = 0.25;

/** A wrapped, staked, bridged or exchange product of an asset that already trades. */
export const DERIVATIVE_DISCOUNT = 0.12;

/** The model's version label: the dashboard names it and every row echoes it. */
export const MODEL_VERSION = 'airdrop-finder-2-comps';

/** The live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
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
    comps_band: string;
    comps_multiple: number;
    comps_n: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    age_band: string;
    quality_multiplier: number;
    provenance_multiplier: number;
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
  comps_multiple: number;
  comps_n: number;
  comps_band: string;
  growth_multiplier: number;
  age_multiplier: number;
  age_band: string;
  quality_multiplier: number;
  provenance_multiplier: number;
}

/** The out-of-sample test of the fitted curve, run on the snapshot itself. */
export interface CompsValidation {
  /** How the live-token protocols were split. */
  split: string;
  train_n: number;
  test_n: number;
  /** The median factor by which a prediction missed, fitted curve against the flat prior. */
  fitted_median_factor: number;
  flat_median_factor: number;
  /** The one flat multiple the baseline uses. */
  flat_multiple: number;
  /** How much closer the fitted curve lands, in per cent. */
  improvement_pct: number;
}

/** Everything the dashboard renders, written beside the page as data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  quality_max: number;
  derivative_discount: number;
  min_band_samples: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  comps_n: number;
  comps: CompsBand[];
  validation: CompsValidation | null;
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
  ratio: number | null;
}

export class SnapshotError extends Error {}

/** A protocol with no recorded token: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol whose token trades and whose ratio can be fitted: both figures, both above zero. */
export function isComp(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && Number.isFinite(p.tvl_usd) && p.tvl_usd > 0;
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

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function quantile(values: number[], f: number): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * f))]!;
}

/**
 * Fit the comps curve from the snapshot's own live-token protocols: for each TVL band, the median
 * market cap / TVL of the protocols whose token trades. A band too thin to trust borrows the nearest
 * band with enough samples, and the row says which.
 */
export function fitComps(protocols: SnapshotProtocol[]): CompsBand[] {
  const ratios = BANDS.map((): number[] => []);
  for (const p of protocols) {
    if (!isComp(p)) continue;
    const b = bandIndex(p.tvl_usd);
    if (b >= 0) ratios[b]!.push(p.mcap_usd! / p.tvl_usd);
  }
  const fitted = ratios.map((r) => (r.length >= MIN_BAND_SAMPLES ? median(r) : null));
  // A band under the sample floor takes the nearest fitted band's multiple, preferring the larger
  // band (a launch's share of TVL falls with size, so the larger neighbour is the conservative pick).
  const nearest = (i: number): number => {
    for (let d = 1; d < BANDS.length; d += 1) {
      if (i + d < BANDS.length && fitted[i + d] !== null) return i + d;
      if (i - d >= 0 && fitted[i - d] !== null) return i - d;
    }
    return -1;
  };
  return BANDS.map((band, i) => {
    const own = ratios[i]!;
    if (fitted[i] !== null) {
      return { label: band.label, multiple: round4(fitted[i]!), n: own.length, p25: round4(quantile(own, 0.25)), p75: round4(quantile(own, 0.75)), borrowed_from: null };
    }
    const j = nearest(i);
    if (j < 0) return { label: band.label, multiple: 0.1, n: own.length, p25: 0, p75: 0, borrowed_from: 'the model default' };
    return { label: band.label, multiple: fitted[j]!, n: own.length, p25: 0, p75: 0, borrowed_from: BANDS[j]!.label };
  });
}

/**
 * Test the fitted curve out of sample: fit on the older half of the live-token protocols, predict the
 * newer half, and compare the median miss against one flat multiple fitted on the same older half.
 * The split is by listed_at, so the test never sees the protocols it is scored on.
 */
export function validateComps(protocols: SnapshotProtocol[], asOf: string): CompsValidation | null {
  const dated = protocols.filter((p) => isComp(p) && p.listed_at !== null);
  if (dated.length < 20) return null;
  const sorted = dated.slice().sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const half = Math.floor(sorted.length / 2);
  const train = sorted.slice(0, half);
  const test = sorted.slice(half);
  const bands = fitComps(train);
  const flat = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
  const fittedErr: number[] = [];
  const flatErr: number[] = [];
  for (const p of test) {
    const b = bandIndex(p.tvl_usd);
    if (b < 0) continue;
    const fittedPred = p.tvl_usd * bands[b]!.multiple;
    if (fittedPred > 0) fittedErr.push(Math.abs(Math.log(p.mcap_usd! / fittedPred)));
    const flatPred = p.tvl_usd * flat;
    if (flatPred > 0) flatErr.push(Math.abs(Math.log(p.mcap_usd! / flatPred)));
  }
  if (fittedErr.length < 5) return null;
  const fittedFactor = Math.exp(median(fittedErr));
  const flatFactor = Math.exp(median(flatErr));
  void asOf;
  return {
    split: `fitted on the ${train.length} live-token protocols first tracked earliest, tested on the ${test.length} later ones`,
    train_n: train.length,
    test_n: test.length,
    fitted_median_factor: round4(fittedFactor),
    flat_median_factor: round4(flatFactor),
    flat_multiple: round4(flat),
    improvement_pct: flatFactor > 0 ? Math.round((1 - fittedFactor / flatFactor) * 100) : 0,
  };
}

/** The clamped seven-day growth, in per cent, or 0 where the snapshot records none. */
export function growthPctOf(p: SnapshotProtocol): number {
  if (p.change_7d === null || !Number.isFinite(p.change_7d)) return 0;
  return Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, p.change_7d));
}

/**
 * The launch-window adjustment: the median comps ratio of live tokens in the same age band, divided
 * by the ratio of all live tokens, shrunk toward 1 by the band's own sample size. A band with four
 * protocols moves the price a little; one with fifty moves it fully.
 */
export function fitAgeFactors(protocols: SnapshotProtocol[], asOf: string): { label: string; lo: number; hi: number; factor: number; n: number }[] {
  const live = protocols.filter(isComp);
  const all = live.map((p) => p.mcap_usd! / p.tvl_usd);
  const overall = all.length > 0 ? median(all) : 1;
  return AGE_BANDS.map((band) => {
    const rows = live.filter((p) => {
      const a = ageDaysOf(p, asOf);
      return a !== null && a >= band.lo && a < band.hi;
    });
    if (rows.length === 0 || overall <= 0) return { ...band, factor: 1, n: rows.length };
    const observed = median(rows.map((p) => p.mcap_usd! / p.tvl_usd)) / overall;
    const w = rows.length / (rows.length + AGE_SHRINKAGE_K);
    return { ...band, factor: round4(1 + (observed - 1) * w), n: rows.length };
  });
}

/** The age adjustment for one protocol's recorded age. */
export function ageFactorOf(age: number | null, factors: { label: string; lo: number; hi: number; factor: number }[]): { factor: number; label: string } {
  if (age === null) return { factor: 1, label: 'age not recorded' };
  for (const band of factors) if (age >= band.lo && age < band.hi) return { factor: band.factor, label: band.label };
  return { factor: 1, label: 'age not recorded' };
}

/** A wrapped, staked, bridged or exchange product of an asset that already trades. */
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

/** The quality multiplier: chains of scale plus a category where a token is the common ending. */
export function qualityOf(p: SnapshotProtocol): number {
  const excluded = p.category !== null && QUALITY_EXCLUDED.includes(p.category);
  if (excluded) return 1;
  const chainHits = Math.min(2, p.chains.filter((c) => QUALITY_CHAINS.includes(c)).length);
  const categoryHit = p.category !== null && QUALITY_CATEGORIES.includes(p.category);
  return round4(1 + Math.min(QUALITY_MAX, chainHits * 0.05 + (categoryHit ? 0.1 : 0)));
}

/** The implied value's factors and their product, in whole dollars. */
export function impliedValue(p: SnapshotProtocol, asOf: string, comps: CompsBand[], ageFactors: { label: string; lo: number; hi: number; factor: number }[]) {
  const b = bandIndex(p.tvl_usd);
  const band = b >= 0 ? comps[b]! : comps[comps.length - 1]!;
  const growthPct = growthPctOf(p);
  const growthMult = round4(1 + (growthPct / 100) * GROWTH_WEIGHT);
  const age = ageDaysOf(p, asOf);
  const ageAdj = ageFactorOf(age, ageFactors);
  const quality = qualityOf(p);
  const derivative = isDerivative(p);
  const provenance = derivative ? DERIVATIVE_DISCOUNT : 1;
  const implied = Math.max(1, Math.round(p.tvl_usd * band.multiple * growthMult * ageAdj.factor * quality * provenance));
  return { band, growthPct, growthMult, age, ageAdj, quality, derivative, provenance, implied };
}

/** The board: every rankable pre-token protocol, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, comps: CompsBand[], ageFactors: { label: string; lo: number; hi: number; factor: number }[]): BoardRow[] {
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, ...impliedValue(p, snapshot.as_of, comps, ageFactors) }));
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
      comps_band: s.band.label,
      comps_multiple: s.band.multiple,
      comps_n: s.band.n,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      age_multiplier: s.ageAdj.factor,
      age_band: s.ageAdj.label,
      quality_multiplier: s.quality,
      provenance_multiplier: s.provenance,
      age_days: s.age === null ? 0 : s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied).map(stepText),
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

/** A farm plan's total cost and its verdict, netted against the implied value. */
export interface FarmCost {
  gas_usd: number;
  capital_usd: number;
  weeks: number;
  total_cost_usd: number;
  verdict: 'farm' | 'thin' | 'skip';
}

/** The plan's cost, and whether the implied value is worth it. */
export function farmCost(p: SnapshotProtocol, age: number | null, implied: number): FarmCost {
  const gas = gasFor(chainOf(p));
  const capital = capitalFor(p.tvl_usd);
  const weeks = 6;
  const gasTotal = gas + Math.max(1, Math.round(gas / 3)) * weeks;
  const total = gasTotal + capital;
  // A token worth less than a tenth of the capital it takes to farm it is not worth the gas.
  const verdict = implied >= capital * 10 ? 'farm' : implied >= capital * 2 ? 'thin' : 'skip';
  void age;
  return { gas_usd: gasTotal, capital_usd: capital, weeks, total_cost_usd: total, verdict };
}

/**
 * A protocol's farm plan: six concrete steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age, implied value), never from a hand-written list
 * of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const cost = farmCost(p, age, implied);
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet for this farm, fund it with $${capital + Math.max(4, gas + 2)} ($${capital} of position money plus gas), and keep its seed offline.`,
      cost: `about $${gas} of gas to get started`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital`,
      time: '15 minutes',
    },
    {
      text: `Make one qualifying action a week for ${cost.weeks} weeks: a deposit, a swap, a borrow or a vote, so the wallet shows repeated intent.`,
      cost: `about $${Math.max(1, Math.round(gas / 3))} of gas a week, $${cost.gas_usd} of gas in all`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position at least ${hold} days. ${age === null ? 'The snapshot does not say when this protocol started, so assume it is early and be patient.' : `It has been tokenless for ${Math.round(age)} days, so ${age >= 90 && age <= 540 ? 'the points era is at its likeliest now' : 'give the position a full quarter before you judge it'}.`}`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the economics before you commit: the whole plan costs about $${cost.total_cost_usd} in gas and locked capital against an implied token value of $${Math.round(implied).toLocaleString('en-US')}, a ${verdictWords(cost.verdict)}.`,
      cost: `$${cost.total_cost_usd} in all`,
      time: '2 minutes',
    },
    {
      text: `Watch ${p.name} (${p.slug}) on the radar board and the protocol's own announcements for a points page or token vote; never pay anyone to claim an airdrop, and log every transaction.`,
      cost: 'no fee to watch, and never pay to claim',
      time: '5 minutes a week',
    },
  ];
  if (isDerivative(p)) {
    steps.splice(1, 0, {
      text: `This is a wrapped, staked, bridged or exchange product of an asset that already trades: it may never issue a token of its own, so treat the activity as a bet on a future points program and cap the capital you park here.`,
      cost: 'no extra cost, it shapes the position size',
      time: 'read once, 2 minutes',
    });
  }
  return steps;
}

/** The verdict in words, for the plan's economics step. */
export function verdictWords(v: FarmCost['verdict']): string {
  if (v === 'farm') return 'plan worth running';
  if (v === 'thin') return 'thin margin, run it only if you already use the protocol';
  return 'skip: the implied value does not cover the capital it takes';
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null)
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
      ratio: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
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
    comps_multiple: row.model.comps_multiple,
    comps_n: row.model.comps_n,
    comps_band: row.model.comps_band,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    age_band: row.model.age_band,
    quality_multiplier: row.model.quality_multiplier,
    provenance_multiplier: row.model.provenance_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = fitComps(snapshot.protocols);
  const ageFactors = fitAgeFactors(snapshot.protocols, snapshot.as_of);
  const board = buildBoard(snapshot, comps, ageFactors);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    growth_weight: GROWTH_WEIGHT,
    growth_floor: GROWTH_FLOOR,
    growth_cap: GROWTH_CAP,
    quality_max: QUALITY_MAX,
    derivative_discount: DERIVATIVE_DISCOUNT,
    min_band_samples: MIN_BAND_SAMPLES,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: live.length,
    comps_n: snapshot.protocols.filter(isComp).length,
    comps,
    validation: validateComps(snapshot.protocols, snapshot.as_of),
    signal_counts: {
      window: board.filter((r) => r.model.age_multiplier > 1).length,
      watchlist: board.filter((r) => watchlist.has(r.slug)).length,
      early: board.filter((r) => !watchlist.has(r.slug)).length,
    },
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
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
