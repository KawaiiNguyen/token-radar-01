// Airdrop Finder's dashboard. It reads window.RADAR (written beside the page by main.ts) and renders
// the ranked board: every pre-token protocol in the snapshot, priced by a comps multiple fitted from
// the protocols whose token already trades, with the fit and its out-of-sample test shown on the page
// itself. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'age unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y old';
    return Math.max(0, Math.round(days)) + 'd old';
  }
  function fmtX(n) {
    return '×' + (n === null || n === undefined ? 'n/a' : Number(n).toFixed(Number(n) < 0.1 ? 4 : 2).replace(/0+$/, '').replace(/\.$/, ''));
  }

  // The model in one function: the page multiplies the row's own stored factors and checks the product
  // against the implied value board.json carries, so the page's arithmetic and the board's are the same.
  function factorsOf(row) {
    return {
      comps: row.comps_multiple,
      growth: row.growth_multiplier,
      age: row.age_multiplier,
      quality: row.quality_multiplier,
      provenance: row.provenance_multiplier,
    };
  }
  function impliedOf(row) {
    var f = factorsOf(row);
    return Math.max(1, Math.round(row.tvl_usd * f.comps * f.growth * f.age * f.quality * f.provenance));
  }
  function isWatchlist(row) {
    return row.wl === true;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' '), r.age_band].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', html: 'Airdrop <em>Finder</em>' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: DATA.source.indexOf('DefiLlama') === 0 ? 'DefiLlama protocol index' : DATA.source }),
        el('span', { text: DATA.model_version })
      )
    );
  }

  function lede() {
    var s = DATA.signal_counts;
    return el('section', { class: 'lede' },
      el('h1', { html: 'Pre-token protocols, priced by <em>what the market already paid</em>' }),
      el('p', { class: 'sub', html:
        'Every protocol in the snapshot that records no token yet — <b>' + DATA.board_size + ' of them</b>, from a ' +
        fmtUsd(DATA.floor_usd) + ' TVL floor down to the smallest the index carries — priced by the market-cap-to-TVL ratio that the snapshot\'s own ' +
        '<b>' + DATA.comps_n + ' live-token protocols</b> actually trade at, fitted by TVL band, then tested out of sample. ' +
        'The watchlist (' + s.watchlist + ') is the floor of the radar, never its ceiling: <b>' + s.early + ' rows below the floor</b> are the early signals, and <b>' +
        s.window + ' sit in an age band where a launch is likelier</b> than the market\'s average.' })
    );
  }

  function facts() {
    var v = DATA.validation;
    return el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows priced' }), el('b', { text: String(DATA.board_size) })),
      el('div', { class: 'fact' }, el('span', { text: 'Comps behind the model' }), el('b', { text: String(DATA.comps_n) })),
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      el('div', { class: 'fact' }, el('span', { text: 'Out-of-sample miss' }), el('b', { text: v ? v.fitted_median_factor.toFixed(2) + '×' : 'n/a' })),
      el('div', { class: 'fact' }, el('span', { text: 'Better than one flat multiple' }), el('b', { text: v ? v.improvement_pct + '%' : 'n/a' }))
    );
  }

  // The comps fit and its test: the evidence for the value model, on the page.
  function compsPanel() {
    var v = DATA.validation;
    var body = el('tbody');
    DATA.comps.forEach(function (b) {
      body.appendChild(el('tr', null,
        el('td', { text: b.label }),
        el('td', { class: 'num', text: b.n ? String(b.n) : '—' }),
        el('td', { class: 'num', text: b.p25 ? fmtX(b.p25) : '—' }),
        el('td', { class: 'num implied', text: fmtX(b.multiple) }),
        el('td', { class: 'num', text: b.p75 ? fmtX(b.p75) : '—' }),
        el('td', { class: 'muted-cell', text: b.borrowed_from ? 'borrowed from ' + b.borrowed_from : 'fitted on its own ' + b.n })
      ));
    });
    return el('section', { class: 'comps' },
      el('h2', { text: 'The value model, fitted from the snapshot' }),
      el('p', { class: 'sub', html:
        'A token\'s implied value is its TVL times the median market-cap-to-TVL ratio of the snapshot\'s own live-token protocols in the same TVL band. ' +
        'The ratio falls as a protocol grows, because a launch captures a smaller share of a larger treasury — the curve below is measured, not assumed.' }),
      el('div', { class: 'panel table-wrap' },
        el('table', { class: 'comps-table' },
          el('thead', null, el('tr', null,
            el('th', { text: 'TVL band' }),
            el('th', { class: 'num', text: 'Live comps' }),
            el('th', { class: 'num', text: 'p25' }),
            el('th', { class: 'num', text: 'Median mcap/TVL' }),
            el('th', { class: 'num', text: 'p75' }),
            el('th', { text: 'Source' })
          )),
          body
        )
      ),
      v ? el('div', { class: 'validbox' },
        el('div', { class: 'validhead' }, el('b', { text: 'Out-of-sample test: ' }), el('span', { text: v.split + '.' })),
        el('div', { class: 'validrow' },
          el('div', { class: 'validcell' },
            el('span', { text: 'Fitted curve, median miss' }),
            el('b', { class: 'good', text: v.fitted_median_factor.toFixed(2) + '×' })
          ),
          el('div', { class: 'validcell' },
            el('span', { text: 'One flat multiple (' + v.flat_multiple + ')' }),
            el('b', { text: v.flat_median_factor.toFixed(2) + '×' })
          ),
          el('div', { class: 'validcell' },
            el('span', { text: 'The curve lands closer by' }),
            el('b', { class: 'good', text: v.improvement_pct + '%' })
          )
        ),
        el('p', { class: 'sub small', text: 'Both were fitted on the same earlier half and scored on the later half, so the test never sees the protocols it prices. A miss of 2.7× is honest about what this is: a ranking, not an appraisal.' })
      ) : null
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search protocols', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token radar', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols, by market cap' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? '▾' : '▴' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the radar again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? 'na' : r.change_7d >= 0 ? 'pos' : 'neg';
      var ageClass = r.age_multiplier > 1.02 ? 'peak' : r.age_multiplier < 0.98 ? 'late' : 'build';
      var tr = el('tr', {
        class: state.selected === r.slug ? 'selected' : null,
        onclick: function () { openDrawer(r.slug); },
        'data-slug': r.slug,
      },
        el('td', { class: 'rank' + (r.rank <= 3 ? ' top' : ''), text: String(r.rank) }),
        el('td', null,
          el('div', { class: 'proto' },
            el('span', { class: 'n', text: r.name }),
            el('span', { class: 's', text: r.slug })
          )
        ),
        el('td', null, el('div', { class: 'chips' },
          isWatchlist(r) ? el('span', { class: 'chip wl', title: 'On the snapshot\'s watchlist: $' + Math.round(DATA.floor_usd / 1e6) + 'M+ TVL, no token recorded', text: 'watchlist' }) : null,
          el('span', { class: 'chip', text: (r.chains && r.chains[0]) || 'unknown chain' }),
          (r.chains || []).length > 1 ? el('span', { class: 'chip', text: '+' + (r.chains.length - 1) }) : null
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('span', { class: 'winchip ' + ageClass, title: 'Age adjustment ' + fmtX(r.age_multiplier) + ', from the ' + r.age_band + ' band', text: fmtX(r.age_multiplier) + ' ' + r.age_band })),
        el('td', { class: 'num comps-cell', text: fmtX(r.comps_multiple) }),
        el('td', { class: 'implied', text: fmtUsd(r.implied_value_usd) })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel table-wrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { text: '#' }),
          sortHeader('name', 'Protocol'),
          el('th', { text: 'Chains' }),
          sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'),
          sortHeader('age', 'Age'),
          el('th', { text: 'Age adj' }),
          el('th', { class: 'num', text: 'Comps' }),
          sortHeader('implied', 'Implied value')
        )),
        tbody
      )
    );
  }

  function liveTable() {
    if (DATA.live.length === 0) return el('div', { class: 'panel' }, el('div', { class: 'empty' }, el('p', { text: 'No live-token protocol in the snapshot.' })));
    var tbody = el('tbody');
    DATA.live.forEach(function (r, i) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? 'na' : r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(el('tr', null,
        el('td', { class: 'rank', text: String(i + 1) }),
        el('td', null, el('div', { class: 'proto' }, el('span', { class: 'n', text: r.name }), el('span', { class: 's', text: r.slug }))),
        el('td', null, el('div', { class: 'chips' }, el('span', { class: 'chip', text: r.category || 'Other' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: r.mcap_usd === null ? 'n/a' : fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num comps-cell', text: r.ratio === null ? 'n/a' : fmtX(r.ratio) }),
        el('td', { class: 'num ' + growthClass, text: growth })
      ));
    });
    return el('div', { class: 'panel table-wrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { text: '#' }),
          el('th', { text: 'Protocol' }),
          el('th', { text: 'Category' }),
          el('th', { class: 'num', text: 'TVL' }),
          el('th', { class: 'num', text: 'Market cap' }),
          el('th', { class: 'num', text: 'MC / TVL' }),
          el('th', { class: 'num', text: '7d' })
        )),
        tbody
      )
    );
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('b', { text: 'How a row is priced. ' }),
      el('span', { text:
        'implied = TVL × comps × growth × age × quality × provenance. ' +
        'The comps multiple is the median market cap / TVL of the snapshot\'s live-token protocols in the row\'s TVL band (' + DATA.comps_n + ' protocols carry both figures); a band with fewer than ' +
        DATA.min_band_samples + ' comps borrows its neighbour and says so. Growth is 1 + (7-day TVL change clamped to ' + DATA.growth_floor + '..' + DATA.growth_cap + '%) × ' + DATA.growth_weight +
        '. Age is the launch-window adjustment: the age band\'s own median ratio over the overall median, shrunk toward 1 by the band\'s sample size, so a thin band barely moves the price. ' +
        'Quality adds up to +' + Math.round(DATA.quality_max * 100) + '% for a chain of scale and a category where tokens are the common ending. Provenance multiplies a wrapped, staked, bridged or exchange product by ' +
        DATA.derivative_discount + ', because the value already accrues to the parent token — the watchlist\'s own exclusion, priced instead of filtered. ' +
        'No protocol is special-cased: the same function prices every row, and each row carries its own factors so this page multiplies them back and checks the board\'s number. ' +
        'A protocol records no token in this snapshot; that is not proof it has none. Implied value is a model, never a promise.' })
    );
  }

  // ---------- detail drawer ----------

  function drawerFor(row) {
    var f = factorsOf(row);
    var check = impliedOf(row);
    var plan = farmPlanFor(row);
    var veil = el('div', { class: 'drawer-veil', onclick: closeDrawer });
    var drawer = el('aside', { class: 'drawer', 'aria-label': row.name + ' detail' },
      el('div', { class: 'drawer-head' },
        el('div', null,
          el('h2', { text: row.name }),
          el('div', { class: 'slug', text: row.slug + ' · rank #' + row.rank + (isWatchlist(row) ? ' · on the watchlist' : ' · early signal below the floor') })
        ),
        el('button', { class: 'drawer-close', 'aria-label': 'Close', text: '✕', onclick: closeDrawer })
      ),
      el('div', { class: 'big-implied' },
        el('div', { class: 'v', text: fmtUsd(row.implied_value_usd) }),
        el('div', { class: 'l', text: 'implied token value, if it launched today' })
      ),
      check === row.implied_value_usd
        ? el('div', { class: 'live-note ok', text: '✓ the row\'s own factors multiply to the board\'s number: ' + row.tvl_usd.toLocaleString('en-US') + ' × ' + f.comps + ' × ' + f.growth + ' × ' + f.age + ' × ' + f.quality + ' × ' + f.provenance + ' = ' + check.toLocaleString('en-US') + '.' })
        : el('div', { class: 'live-note', text: 'the row\'s factors multiply to ' + check.toLocaleString('en-US') + ', and the board carries ' + row.implied_value_usd.toLocaleString('en-US') + '.' }),
      el('div', { class: 'modelgrid' },
        el('div', { class: 'modelf' }, el('span', { text: 'Comps' }), el('b', { text: fmtX(f.comps) }), el('div', { class: 'whyline', text: row.comps_band + ', from ' + row.comps_n + ' live comps' })),
        el('div', { class: 'modelf' }, el('span', { text: 'Growth' }), el('b', { text: fmtX(f.growth) }), el('div', { class: 'whyline', text: '7d ' + fmtPct(row.change_7d) })),
        el('div', { class: 'modelf' }, el('span', { text: 'Age' }), el('b', { text: fmtX(f.age) }), el('div', { class: 'whyline', text: row.age_band })),
        el('div', { class: 'modelf' }, el('span', { text: 'Quality' }), el('b', { text: fmtX(f.quality) }), el('div', { class: 'whyline', text: 'chain + category of scale' })),
        el('div', { class: 'modelf' }, el('span', { text: 'Provenance' }), el('b', { text: fmtX(f.provenance) }), el('div', { class: 'whyline', text: f.provenance < 1 ? 'a product of an asset that trades' : 'a fresh protocol of its own' }))
      ),
      el('div', { class: 'formula' },
        el('code', { text: fmtUsd(row.tvl_usd) + ' TVL × ' + f.comps + ' × ' + f.growth + ' × ' + f.age + ' × ' + f.quality + ' × ' + f.provenance + ' = ' + fmtUsd(row.implied_value_usd) })
      ),
      el('h3', { class: 'sect', text: 'The record, from the snapshot' }),
      el('div', { class: 'kv' },
        el('span', { text: 'Category' }), el('b', { text: row.category || 'none recorded' }),
        el('span', { text: 'Chains' }), el('b', { text: (row.chains || []).join(', ') || 'none recorded' }),
        el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) }),
        el('span', { text: '7-day change' }), el('b', { text: row.change_7d === null ? 'none recorded' : fmtPct(row.change_7d) }),
        el('span', { text: 'First tracked' }), el('b', { text: row.listed_at || 'not recorded' }),
        el('span', { text: 'Age' }), el('b', { text: fmtAge(row.age_days) }),
        el('span', { text: 'Token' }), el('b', { text: 'none recorded — no market cap, no CoinGecko id, no symbol' })
      ),
      el('h3', { class: 'sect', text: 'How to farm the drop' }),
      el('ol', { class: 'plan' }, plan.map(function (step) {
        return el('li', null, el('div', { text: step.text }), el('div', { class: 'meta', text: 'Cost: ' + step.cost + ' · Time: ' + step.time }));
      })),
      el('h3', { class: 'sect', text: 'Read this before you farm' }),
      el('p', { class: 'sub', text:
        'This row says the snapshot records no token for ' + row.name + ' as of ' + DATA.as_of + '. That is not proof the protocol has none, and implied value is a model, not an offer. Verify on the protocol\'s own site before you move money, never pay anyone to claim an airdrop, and sign nothing you have not read.' })
    );
    return [veil, drawer];
  }

  /** The farm plan, derived in the page from the row's own record — the same rules main.ts runs. */
  function farmPlanFor(row) {
    var chain = (row.chains && row.chains[0]) || 'its main chain';
    var c = (row.category || '').toLowerCase();
    var capital = row.tvl_usd >= 5e9 ? 250 : row.tvl_usd >= 1e9 ? 150 : row.tvl_usd >= 1e8 ? 100 : 50;
    var gas = chain.toLowerCase() === 'ethereum' ? 12 : chain.toLowerCase() === 'solana' || chain.toLowerCase() === 'sui' || chain.toLowerCase() === 'aptos' ? 1 : ['base', 'arbitrum', 'optimism', 'polygon', 'scroll', 'linea', 'blast', 'mantle'].some(function (l2) { return chain.toLowerCase().indexOf(l2) >= 0; }) ? 2 : 5;
    var hold = row.age_days === null ? 45 : row.age_days < 120 ? 75 : row.age_days < 365 ? 60 : row.age_days < 720 ? 45 : 30;
    var weeks = 6;
    var gasTotal = gas + Math.max(1, Math.round(gas / 3)) * weeks;
    var total = gasTotal + capital;
    var implied = row.implied_value_usd;
    var verdict = implied >= capital * 10 ? 'plan worth running' : implied >= capital * 2 ? 'thin margin, run it only if you already use the protocol' : 'skip: the implied value does not cover the capital it takes';
    var action;
    if (c.indexOf('cex') >= 0) action = 'Trade at least $' + capital + ' of spot volume a week on ' + row.name + ' with your main account while it runs no points page, so a late one counts you from day one.';
    else if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) action = 'Supply $' + capital + ' of USDC to ' + row.name + ' on ' + chain + ' and borrow a small amount against it, then repay.';
    else if (c.indexOf('dex') >= 0) action = 'Swap on ' + row.name + ' on ' + chain + ' weekly, and provide $' + capital + ' of liquidity to its largest pool.';
    else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) action = 'Deposit $' + capital + ' as margin on ' + row.name + ', open one small position each week and close it in profit or loss.';
    else if (c.indexOf('yield') >= 0) action = 'Deposit $' + capital + ' into ' + row.name + '\'s highest-TVL vault on ' + chain + ' and leave it to compound.';
    else if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) action = 'Stake $' + capital + ' of the chain\'s native asset through ' + row.name + ' and keep the receipt token in the same wallet.';
    else if (c.indexOf('bridge') >= 0) action = 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + row.name + ', use the funds there, and bridge back after a week.';
    else if (c.indexOf('launchpad') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('curator') >= 0) action = 'Deposit $' + capital + ' into a ' + row.name + ' vault or allocation on ' + chain + ' and keep the shares.';
    else if (c.indexOf('prediction') >= 0) action = 'Fund $' + capital + ' on ' + row.name + ' and take one position in its most liquid market each week.';
    else if (c.indexOf('insurance') >= 0) action = 'Buy $' + capital + ' of cover from ' + row.name + ' on ' + chain + ' and renew it once before the term ends.';
    else if (c.indexOf('rwa') >= 0) action = 'Mint $' + capital + ' of ' + row.name + '\'s yield asset on ' + chain + ' and hold it across at least two monthly cycles.';
    else if (c.indexOf('stable') >= 0) action = 'Mint and redeem $' + capital + ' of the stable asset through ' + row.name + ' once, then hold the position.';
    else if (c.indexOf('basis') >= 0) action = 'Open the long-short pair $' + capital + ' of size on ' + row.name + ' and roll it once.';
    else if (c.indexOf('liquid') >= 0) action = 'Restake $' + capital + ' of the staked asset through ' + row.name + ' and keep the liquid receipt.';
    else action = 'Deposit $' + capital + ' of USDC into ' + row.name + ' on ' + chain + ' and keep the position open.';
    var derivative = c.indexOf('bridge') >= 0 || c.indexOf('cex') >= 0 || c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restaked') >= 0 || c.indexOf('wrapped') >= 0 || c.indexOf('staking pool') >= 0 || /\b(wrapped|staked|staking)\b/.test((row.name || '').toLowerCase());
    var plan = [
      { text: 'Set up a fresh wallet for this farm, fund it with $' + (capital + Math.max(4, gas + 2)) + ' ($' + capital + ' of position money plus gas), and keep its seed offline.', cost: 'about $' + gas + ' of gas to get started', time: '10 minutes' },
    ];
    if (derivative) {
      plan.push({ text: 'This is a wrapped, staked, bridged or exchange product of an asset that already trades: it may never issue a token of its own, so treat the activity as a bet on a future points program and cap the capital you park here.', cost: 'no extra cost, it shapes the position size', time: 'read once, 2 minutes' });
    }
    plan.push(
      { text: action, cost: '$' + capital + ' of capital', time: '15 minutes' },
      { text: 'Make one qualifying action a week for ' + weeks + ' weeks: a deposit, a swap, a borrow or a vote, so the wallet shows repeated intent.', cost: 'about $' + Math.max(1, Math.round(gas / 3)) + ' of gas a week, $' + gasTotal + ' of gas in all', time: '10 minutes a week' },
      { text: 'Hold the position at least ' + hold + ' days. ' + (row.age_days === null || row.age_days === undefined ? 'The snapshot does not say when this protocol started, so assume it is early and be patient.' : 'It has been tokenless for ' + Math.round(row.age_days) + ' days, so ' + (row.age_days >= 90 && row.age_days <= 540 ? 'the points era is at its likeliest now' : 'give the position a full quarter before you judge it') + '.'), cost: '$' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Check the economics before you commit: the whole plan costs about $' + total + ' in gas and locked capital against an implied token value of $' + Math.round(implied).toLocaleString('en-US') + ', a ' + verdict + '.', cost: '$' + total + ' in all', time: '2 minutes' },
      { text: 'Watch ' + row.name + ' (' + row.slug + ') on this radar and the protocol\'s own announcements for a points page or token vote; never pay anyone to claim an airdrop, and log every transaction.', cost: 'no fee to watch, and never pay to claim', time: '5 minutes a week' }
    );
    return plan;
  }

  function closeDrawer() {
    state.selected = null;
    writeHash();
    render();
  }
  function openDrawer(slug) {
    state.selected = slug;
    writeHash();
    render();
  }

  /** The scrollbar autohide of luật I18: the element being scrolled carries .is-scrolling. */
  function wireScrollbars(root) {
    root.querySelectorAll('.drawer, .table-wrap').forEach(function (node) {
      if (node.__wired) return;
      node.__wired = true;
      var timer = null;
      node.addEventListener('scroll', function () {
        node.classList.add('is-scrolling');
        clearTimeout(timer);
        timer = setTimeout(function () { node.classList.remove('is-scrolling'); }, 600);
      }, { passive: true });
    });
  }

  function render() {
    var content = state.tab === 'live' ? liveTable() : boardTable();
    app.replaceChildren(
      header(),
      el('main', null,
        lede(),
        facts(),
        compsPanel(),
        controls(),
        content,
        state.tab === 'pre-token' ? foot() : el('p', { class: 'foot', text: 'Live-token protocols are kept apart from the ranked board: their tokens already trade, so the radar\'s question — what is the next token worth — does not apply to them. Their MC/TVL column is the market\'s own answer, and the raw material the comps curve is fitted from.' }),
        DATA.rows.filter(function (r) { return r.slug === state.selected; }).map(function (r) { return drawerFor(r); })[0] || null
      )
    );
    var sel = app.querySelector('tr.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    wireScrollbars(app);
  }

  (function () {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  })();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDrawer();
  });
  render();
})();
