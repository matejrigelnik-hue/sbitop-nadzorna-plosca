/**
 * SBI TOP Institucionalni Analitični & Vrednotenjski Terminal
 * Glavna aplikacijska logika:
 *  - Modul 1: Pregled indeksa SBI TOP & Glavna vrednotenjska matrika
 *  - Modul 2: 10-letni zgodovinski finančni podatki (2016–2025 + 2026 TTM/9M)
 *  - Modul 3: Interaktivni simulator projekcij in poštene vrednosti (DCF / Owner Earnings / DDM)
 *  - Modul 4: Primerjava s tujimi primerljivimi podjetji
 *  - Modul 5: Primerjava trenutnih kazalnikov vrednotenj z 10-letno zgodovino podjetij samih (2016–2026)
 */

(function () {
  "use strict";

  const DATA = window.SBITOP_DATA;
  if (!DATA || !DATA.companies) {
    console.error("Manjka window.SBITOP_DATA!");
    return;
  }

  let selectedTicker = "KRKG";
  let activeView = "all";
  const charts = {};

  // Simulator State
  let simState = {
    baseCashFlowM: 430.3,
    growthStage1Pct: 6.5,
    growthStage2Pct: 4.5,
    waccPct: 8.8,
    terminalGrowthPct: 2.5,
    exitMultiple: 12.5,
    terminalMethod: "gordon",
    mosPct: 15.0,
    netDebtM: -329.5,
    sharesM: 30.556,
    activePreset: "base"
  };

  // Number Formatters (Slovenian locale)
  function fmtNum(val, decimals = 2, suffix = "") {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "—";
    return Number(val).toLocaleString("sl-SI", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }) + suffix;
  }

  function fmtSignedPct(val, decimals = 1) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "—";
    const n = Number(val);
    const sign = n > 0 ? "+" : "";
    return sign + n.toLocaleString("sl-SI", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }) + " %";
  }

  function getCompany(ticker) {
    return DATA.companies.find((c) => c.ticker === ticker) || DATA.companies[0];
  }

  // Core 10-Year 2-Stage DCF / Owner Earnings Engine
  function computeDcfModel(params, currentPrice) {
    const baseCf = Number(params.baseCashFlowM) || 0;
    const g1 = (Number(params.growthStage1Pct) || 0) / 100;
    const g2 = (Number(params.growthStage2Pct) || 0) / 100;
    const wacc = Math.max(0.03, (Number(params.waccPct) || 8.5) / 100);
    const termG = Math.min(wacc - 0.01, (Number(params.terminalGrowthPct) || 2.0) / 100);
    const exitMult = Number(params.exitMultiple) || 10.0;
    const method = params.terminalMethod || "gordon";
    const mos = (Number(params.mosPct) || 15) / 100;
    const netDebt = Number(params.netDebtM) || 0;
    const shares = Math.max(0.001, Number(params.sharesM) || 1);

    const years = [];
    let currCf = baseCf;
    let sumPvCf = 0;

    for (let yr = 1; yr <= 10; yr++) {
      const g = yr <= 5 ? g1 : g2;
      currCf = currCf * (1 + g);
      const df = 1 / Math.pow(1 + wacc, yr);
      const pv = currCf * df;
      sumPvCf += pv;
      years.push({
        step: yr,
        calendarYear: 2025 + yr,
        growthPct: g * 100,
        cashFlowM: currCf,
        discountFactor: df,
        pvCashFlowM: pv
      });
    }

    const cfYear10 = years[years.length - 1].cashFlowM;
    const dfYear10 = years[years.length - 1].discountFactor;

    const tvGordon = wacc > termG ? (cfYear10 * (1 + termG)) / (wacc - termG) : cfYear10 * exitMult;
    const tvMultiple = cfYear10 * exitMult;

    let terminalValueM = tvGordon;
    if (method === "multiple") {
      terminalValueM = tvMultiple;
    } else if (method === "blended") {
      terminalValueM = 0.5 * tvGordon + 0.5 * tvMultiple;
    }

    const pvTerminalM = terminalValueM * dfYear10;
    const enterpriseValueM = sumPvCf + pvTerminalM;
    const equityValueM = enterpriseValueM - netDebt;
    const fairValuePerShare = Math.max(0, equityValueM / shares);
    const buyPriceWithMos = fairValuePerShare * (1 - mos);
    const upsidePct = currentPrice > 0 ? ((fairValuePerShare - currentPrice) / currentPrice) * 100 : 0;
    const impliedMosPct = fairValuePerShare > 0 ? ((fairValuePerShare - currentPrice) / fairValuePerShare) * 100 : 0;

    return {
      years,
      sumPvCfM: sumPvCf,
      terminalValueM,
      pvTerminalM,
      tvShareOfEvPct: enterpriseValueM > 0 ? (pvTerminalM / enterpriseValueM) * 100 : 0,
      enterpriseValueM,
      netDebtM: netDebt,
      equityValueM,
      sharesM: shares,
      fairValuePerShare,
      buyPriceWithMos,
      upsidePct,
      impliedMosPct
    };
  }

  function computeCompanyDefaultDcf(comp) {
    const d = comp.dcfDefaults;
    return computeDcfModel({
      baseCashFlowM: d.baseCashFlowM,
      growthStage1Pct: d.growthStage1Pct,
      growthStage2Pct: d.growthStage2Pct,
      waccPct: d.waccPct,
      terminalGrowthPct: d.terminalGrowthPct,
      exitMultiple: d.exitMultiple,
      terminalMethod: "gordon",
      mosPct: d.mosPct,
      netDebtM: d.netDebtM,
      sharesM: d.sharesM
    }, comp.current.price);
  }

  // Destroy and recreate Chart.js instance cleanly
  function renderChart(key, canvasId, config) {
    if (charts[key]) {
      charts[key].destroy();
    }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    charts[key] = new Chart(ctx, config);
  }

  // =========================================================================
  // HEADER, TICKER TAPE & PILL SELECTOR
  // =========================================================================
  function renderHeaderAndSelectors() {
    const idx = DATA.indexSummary;
    const tapeEl = document.getElementById("tickerTape");
    let tapeHtml = `
      <div class="tape-index-badge">
        <span>SBI TOP</span>
        <span class="mono">${fmtNum(idx.value, 2)}</span>
        <span class="text-emerald mono">${fmtSignedPct(idx.change1YPct, 2)} (1L)</span>
      </div>
      <div class="tape-index-badge" style="background: rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.3); color: #34d399;">
        <span>SBI TOP TR</span>
        <span class="mono">${fmtNum(idx.totalReturnValue, 2)}</span>
        <span class="mono">10L CAGR: +${fmtNum(idx.cagr10YTotalReturnPct, 2)} %</span>
      </div>
    `;

    DATA.companies.forEach((c) => {
      const isAct = c.ticker === selectedTicker ? "active" : "";
      const chgClass = c.current.change1YPct >= 0 ? "text-emerald" : "text-rose";
      tapeHtml += `
        <div class="tape-item ${isAct}" data-ticker="${c.ticker}">
          <span class="tape-symbol">${c.ticker}</span>
          <span class="tape-price">${fmtNum(c.current.price, 2)} €</span>
          <span class="${chgClass} mono">${fmtSignedPct(c.current.change1YPct, 1)}</span>
        </div>
      `;
    });
    tapeEl.innerHTML = tapeHtml;

    tapeEl.querySelectorAll(".tape-item").forEach((el) => {
      el.addEventListener("click", () => selectCompany(el.getAttribute("data-ticker")));
    });

    // Select Dropdown
    const selectEl = document.getElementById("companySelect");
    selectEl.innerHTML = DATA.companies
      .map((c) => `<option value="${c.ticker}" ${c.ticker === selectedTicker ? "selected" : ""}>${c.ticker} — ${c.shortName} (${fmtNum(c.current.price, 2)} €)</option>`)
      .join("");

    // 9-Company Pill Bar
    const pillBarEl = document.getElementById("companyPillBar");
    pillBarEl.innerHTML = DATA.companies
      .map((c) => {
        const isAct = c.ticker === selectedTicker ? "active" : "";
        const chgClass = c.current.change1YPct >= 0 ? "text-emerald" : "text-rose";
        return `
          <div class="company-pill ${isAct}" data-ticker="${c.ticker}">
            <div class="pill-top">
              <span class="pill-ticker">${c.ticker}</span>
              <span class="pill-weight">${fmtNum(c.sbitopWeight, 1)} %</span>
            </div>
            <div class="pill-name">${c.shortName}</div>
            <div class="pill-bottom">
              <span>${fmtNum(c.current.price, 2)} €</span>
              <span class="${chgClass}">${fmtSignedPct(c.current.change1YPct, 1)}</span>
            </div>
          </div>
        `;
      })
      .join("");

    pillBarEl.querySelectorAll(".company-pill").forEach((el) => {
      el.addEventListener("click", () => selectCompany(el.getAttribute("data-ticker")));
    });
  }

  // =========================================================================
  // MODULE 1: SBI TOP INDEX OVERVIEW & MASTER SCREENER
  // =========================================================================
  function renderModule1Index() {
    const idx = DATA.indexSummary;
    const kpiGrid = document.getElementById("indexKpiGrid");

    kpiGrid.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label"><span>Vrednost indeksa SBI TOP</span><span class="badge badge-emerald">${fmtSignedPct(idx.change1YPct, 2)} (1L)</span></div>
        <div class="kpi-value">${fmtNum(idx.value, 2)} <span style="font-size:13px;color:var(--text-secondary);">točk</span></div>
        <div class="kpi-sub">10-letni cenovni CAGR (2016–2026): <strong class="text-emerald">+${fmtNum(idx.cagr10YPricePct, 2)} %/leto</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>SBI TOP TR (Bruto donos z dividendami)</span><span class="badge badge-blue">4,56x v 10L</span></div>
        <div class="kpi-value">${fmtNum(idx.totalReturnValue, 2)} <span style="font-size:13px;color:var(--text-secondary);">točk</span></div>
        <div class="kpi-sub">10-letni skupni donos CAGR: <strong class="text-emerald">+${fmtNum(idx.cagr10YTotalReturnPct, 2)} %/leto</strong> (vs. DAX +7,26 %)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Skupna tržna kapitalizacija (9 družb)</span><span class="badge badge-neutral">LJSE Prva kotacija</span></div>
        <div class="kpi-value">${fmtNum(idx.totalMarketCapEurBn, 2)} <span style="font-size:13px;color:var(--text-secondary);">mrd €</span></div>
        <div class="kpi-sub">Letni prihodki: <strong>${fmtNum(idx.totalRevenue2025EurBn, 2)} mrd €</strong> · Čisti dobiček: <strong>${fmtNum(idx.totalNetIncome2025EurBn, 2)} mrd €</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Tehtani večkratniki indeksa SBI TOP</span><span class="badge badge-blue">Kakovost & Dividende</span></div>
        <div class="kpi-value">P/E ${fmtNum(idx.weightedPe, 2)}x <span style="font-size:14px;color:var(--text-secondary);">· P/B ${fmtNum(idx.weightedPb, 2)}x</span></div>
        <div class="kpi-sub">Tehtana div. donosnost: <strong class="text-emerald">${fmtNum(idx.weightedDivYieldPct, 2)} %</strong> · Tehtani ROE: <strong>${fmtNum(idx.weightedRoePct, 1)} %</strong></div>
      </div>
    `;

    // Chart 1A: 10-Year Indexed Performance SBI TOP vs SBI TOP TR vs DAX (2016 = 100)
    const hist = idx.annualHistory;
    const baseSbi = hist[0].sbitop;
    const baseTr = hist[0].sbitopTr;
    const baseDax = hist[0].dax;

    renderChart("indexPerf", "chartIndexPerformance", {
      type: "line",
      data: {
        labels: hist.map((h) => h.year),
        datasets: [
          {
            label: "SBI TOP TR (z reinvestiranimi dividendami, 2016=100)",
            data: hist.map((h) => Number(((h.sbitopTr / baseTr) * 100).toFixed(1))),
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.12)",
            borderWidth: 2.8,
            fill: true,
            tension: 0.28,
            pointRadius: 3.5
          },
          {
            label: "SBI TOP Cenovni indeks (2016=100)",
            data: hist.map((h) => Number(((h.sbitop / baseSbi) * 100).toFixed(1))),
            borderColor: "#38bdf8",
            backgroundColor: "transparent",
            borderWidth: 2.4,
            tension: 0.28,
            pointRadius: 3
          },
          {
            label: "DAX 40 Nemški indeks (2016=100)",
            data: hist.map((h) => Number(((h.dax / baseDax) * 100).toFixed(1))),
            borderColor: "#94a3b8",
            borderDash: [5, 4],
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0.28,
            pointRadius: 2.5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#cbd5e1", font: { size: 11.5 } } }
        },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: {
            ticks: { color: "#94a3b8", callback: (v) => v + " pt" },
            grid: { color: "rgba(148,163,184,0.08)" }
          }
        }
      }
    });

    // Chart 1B: Current P/E vs 10Y Average P/E vs Foreign Peer Median P/E (for the 9 companies with peers)
    const peerComps = DATA.companies.filter((c) => c.includedInPeerComparison);
    renderChart("indexMult", "chartIndexMultiples", {
      type: "bar",
      data: {
        labels: peerComps.map((c) => c.ticker),
        datasets: [
          {
            label: "Trenutni P/E (Nov 2026)",
            data: peerComps.map((c) => c.current.pe),
            backgroundColor: "#38bdf8",
            borderRadius: 4
          },
          {
            label: "Lastno 10-letno povprečje P/E (2016–2025)",
            data: peerComps.map((c) => c.historicalValuation.pe.avg10y),
            backgroundColor: "#6366f1",
            borderRadius: 4
          },
          {
            label: "Mediana tujih primerljivih podjetij P/E",
            data: peerComps.map((c) => c.peerComparison.peerMedian.pe),
            backgroundColor: "#10b981",
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#cbd5e1", font: { size: 11.5 } } }
        },
        scales: {
          x: { ticks: { color: "#cbd5e1", font: { weight: "700" } }, grid: { display: false } },
          y: {
            ticks: { color: "#94a3b8", callback: (v) => v + "x" },
            grid: { color: "rgba(148,163,184,0.08)" }
          }
        }
      }
    });

    // Master Screener Table
    const tbody = document.getElementById("masterScreenerBody");
    tbody.innerHTML = DATA.companies
      .map((c) => {
        const cur = c.current;
        const dcf = computeCompanyDefaultDcf(c);
        const hvPe = c.historicalValuation.pe;
        const pc = c.peerComparison;
        const isSel = c.ticker === selectedTicker ? "highlight-row" : "";

        const upsideBadgeClass = dcf.upsidePct >= 5 ? "badge-emerald" : dcf.upsidePct >= -12 ? "badge-amber" : "badge-rose";
        const peerPeStr = pc.included ? fmtNum(pc.peerMedian.pe, 1) + "x" : "Izvzeto (FFO/NAV)";
        const peerDiffVal = pc.included ? pc.premiumVsPeerMedianPct.pe : null;
        const peerDiffBadge = pc.included
          ? `<span class="badge ${peerDiffVal <= 0 ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(peerDiffVal, 1)}</span>`
          : `<span class="badge badge-neutral">Izvzeto</span>`;

        const zVal = hvPe ? hvPe.zScore : 0;
        const zClass = zVal <= 0.5 ? "text-emerald" : zVal <= 1.8 ? "text-amber" : "text-rose";

        return `
          <tr class="${isSel}" data-ticker="${c.ticker}" style="cursor:pointer;" title="Kliknite za izbiro družbe ${c.name}">
            <td class="label-cell">
              <strong class="mono text-blue">${c.ticker}</strong> · ${c.shortName}
            </td>
            <td style="text-align:left;color:var(--text-secondary);font-family:var(--font-sans);">${c.sector}</td>
            <td>${fmtNum(c.sbitopWeight, 2)} %</td>
            <td><strong>${fmtNum(cur.price, 2)} €</strong></td>
            <td>${fmtNum(cur.marketCapM, 1)}</td>
            <td><strong>${fmtNum(dcf.fairValuePerShare, 2)} €</strong></td>
            <td><span class="badge ${upsideBadgeClass}">${fmtSignedPct(dcf.upsidePct, 1)}</span></td>
            <td>${fmtNum(cur.pe, 2)}x</td>
            <td>${fmtNum(hvPe ? hvPe.avg10y : null, 2)}x</td>
            <td>${peerPeStr}</td>
            <td>${peerDiffBadge}</td>
            <td>${fmtNum(cur.pb, 2)}x ${cur.pNav ? `<span class="text-emerald" style="font-size:11px;">(P/NAV ${fmtNum(cur.pNav, 2)}x)</span>` : ""}</td>
            <td>${cur.evEbitda ? fmtNum(cur.evEbitda, 2) + "x" : "— (Fin.)"}</td>
            <td class="text-emerald"><strong>${fmtNum(cur.divYieldPct, 2)} %</strong></td>
            <td>${fmtNum(cur.roePct, 1)} %</td>
            <td class="${zClass}">${zVal > 0 ? "+" : ""}${fmtNum(zVal, 2)}σ</td>
          </tr>
        `;
      })
      .join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => selectCompany(tr.getAttribute("data-ticker")));
    });
  }

  // =========================================================================
  // MODULE 2: 10-YEAR HISTORICAL FINANCIALS (2016–2025 + 2026 TTM/9M)
  // =========================================================================
  function renderModule2Financials(comp) {
    const cur = comp.current;
    const cagrs = comp.cagrs10y;
    const hist = comp.history;
    const latestReportUrl = hist[hist.length - 1].reportUrl || "https://seonet.ljse.si";

    document.getElementById("finSectionTitle").textContent =
      `${comp.name} (${comp.ticker}) — 10-letni zgodovinski finančni podatki (2016–2025 + 2026 TTM)`;

    document.getElementById("finReportLinkWrap").innerHTML = `
      <a href="${latestReportUrl}" target="_blank" rel="noopener" class="btn-action" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
        <span>Uradno revidirano poročilo (SEOnet PDF)</span>
      </a>
    `;

    // Hero Banner with Thesis, Interim 2026 & BII Pillars
    const p = comp.biiPillars;
    const pillarLabels = [
      { key: "predictability", label: "Predvidljivost poslovanja", val: p.predictability },
      { key: "moat", label: "Konkurenčni jarek (Moat)", val: p.moat },
      { key: "management", label: "Upravljanje in alokacija kapitala", val: p.management },
      { key: "financial", label: "Bilančna trdnost", val: p.financial },
      { key: "roic", label: "Donosnost kapitala (ROE / ROIC)", val: p.roic },
      { key: "price", label: "Privlačnost vrednotenja & dividende", val: p.price }
    ];

    document.getElementById("companyHeroBanner").innerHTML = `
      <div>
        <div class="hero-title-row">
          <span class="hero-ticker">${comp.ticker}</span>
          <h3 class="hero-name">${comp.name}</h3>
          <span class="badge badge-blue">ISIN: ${comp.isin}</span>
          <span class="badge badge-emerald">Piotroski F-Score: ${comp.fScore}/9</span>
          <span class="badge badge-neutral">Utež v SBI TOP: ${fmtNum(comp.sbitopWeight, 2)} %</span>
        </div>
        <p class="hero-thesis">${comp.thesis.summary}</p>
        <div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:12px;">
          <strong class="text-blue">Konkurenčna prednost (Moat):</strong> ${comp.thesis.moat}
        </div>
        <div class="interim-banner">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:4px;">
            <strong class="text-emerald">Tekoče poslovanje v letu 2026 (${comp.interim2026.period}):</strong>
            <span class="mono">Prihodki: <strong>${fmtNum(comp.interim2026.revenueM, 1)} mio €</strong> (${fmtSignedPct(comp.interim2026.yoyRevenuePct, 1)} YoY) · Čisti dobiček: <strong>${fmtNum(comp.interim2026.netIncomeM, 1)} mio €</strong> (${fmtSignedPct(comp.interim2026.yoyNetIncomePct, 1)} YoY)</span>
          </div>
          <div style="color:var(--text-secondary);font-size:12px;">${comp.interim2026.highlights}</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;justify-content:space-between;gap:14px;background:rgba(9,14,23,0.75);padding:16px;border-radius:var(--radius-md);border:1px solid var(--border-subtle);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:700;">Kakovostni profil družbe (Buffett Index)</div>
            <div style="font-size:14px;font-weight:700;color:var(--text-primary);">6 stebrov temeljnih kazalnikov</div>
          </div>
          <span class="badge badge-emerald" style="font-size:13px;">BII: ${comp.biiScore} / 600</span>
        </div>
        <div class="pillar-grid">
          ${pillarLabels
            .map(
              (pl) => `
            <div class="pillar-item">
              <div class="pillar-top">
                <span>${pl.label}</span>
                <span class="mono">${pl.val}/100</span>
              </div>
              <div class="pillar-track">
                <div class="pillar-bar" style="width:${pl.val}%;"></div>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--text-muted);border-top:1px solid var(--border-subtle);padding-top:8px;">
          <span>Št. izdanih delnic: <strong class="mono text-primary">${fmtNum(comp.sharesIssuedM, 3)} mio</strong></span>
          <span>Brez lastnih delnic: <strong class="mono text-primary">${fmtNum(comp.sharesEffectiveM, 3)} mio</strong></span>
        </div>
      </div>
    `;

    // Company 6 KPI Cards
    document.getElementById("companyKpiGrid").innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label"><span>Borzni tečaj (${cur.asOfDate})</span><span class="badge ${cur.change1YPct >= 0 ? "badge-emerald" : "badge-rose"}">${fmtSignedPct(cur.change1YPct, 1)} (1L)</span></div>
        <div class="kpi-value">${fmtNum(cur.price, 2)} €</div>
        <div class="kpi-sub">10L CAGR tečaja (2016–2026): <strong class="text-emerald">${fmtSignedPct(cagrs.priceCagrPct, 1)}/leto</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Tržna kapitalizacija & EV</span><span class="badge badge-neutral">Utež ${fmtNum(comp.sbitopWeight, 1)} %</span></div>
        <div class="kpi-value">${fmtNum(cur.marketCapM, 1)} <span style="font-size:13px;color:var(--text-secondary);">mio €</span></div>
        <div class="kpi-sub">EV: <strong>${fmtNum(cur.enterpriseValueM, 1)} mio €</strong> · Čisti dolg: <strong>${fmtNum(cur.netDebtM, 1)} mio €</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>${comp.revenueLabel} (FY 2025)</span><span class="badge badge-blue">10L CAGR ${fmtSignedPct(cagrs.revenueCagrPct, 1)}</span></div>
        <div class="kpi-value">${fmtNum(cur.revenueM, 1)} <span style="font-size:13px;color:var(--text-secondary);">mio €</span></div>
        <div class="kpi-sub">2016: <strong>${fmtNum(hist[0].revenueM, 1)} mio €</strong> → 2025: <strong>${fmtNum(cur.revenueM, 1)} mio €</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Čisti poslovni izid (FY 2025)</span><span class="badge badge-emerald">10L CAGR ${fmtSignedPct(cagrs.netIncomeCagrPct, 1)}</span></div>
        <div class="kpi-value">${fmtNum(cur.netIncomeM, 1)} <span style="font-size:13px;color:var(--text-secondary);">mio €</span></div>
        <div class="kpi-sub">EPS (TTM): <strong>${fmtNum(cur.eps, 2)} €</strong> · Čista marža: <strong>${fmtNum(cur.netMarginPct, 1)} %</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Kapital & Donosnost (ROE)</span><span class="badge badge-blue">BVPS ${fmtNum(cur.bvps, 2)} €</span></div>
        <div class="kpi-value">${fmtNum(cur.roePct, 1)} % <span style="font-size:13px;color:var(--text-secondary);">ROE</span></div>
        <div class="kpi-sub">Kapital: <strong>${fmtNum(cur.equityM, 1)} mio €</strong> ${cur.navPerShare ? `· Ocenjeni NAV: <strong class="text-emerald">${fmtNum(cur.navPerShare, 2)} €/deln.</strong>` : `· ROIC: <strong>${fmtNum(cur.roicPct, 1)} %</strong>`}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Dividenda na delnico (2026)</span><span class="badge badge-emerald">${fmtNum(cur.divYieldPct, 2)} % donos</span></div>
        <div class="kpi-value">${fmtNum(cur.dps, 2)} €</div>
        <div class="kpi-sub">10L CAGR dividende: <strong class="text-emerald">${fmtSignedPct(cagrs.dpsCagrPct, 1)}/leto</strong> (2016: ${fmtNum(hist[0].dps, 2)} €)</div>
      </div>
    `;

    const years = hist.map((h) => h.year);

    // Chart 2A: Revenue, EBITDA/EBIT & Net Income (2016-2025)
    renderChart("revProfit10Y", "chartRevProfit10Y", {
      type: "bar",
      data: {
        labels: years,
        datasets: [
          {
            label: comp.revenueLabel + " (mio €)",
            data: hist.map((h) => h.revenueM),
            backgroundColor: "rgba(56, 189, 248, 0.75)",
            borderRadius: 3
          },
          {
            label: (hist[9].ebitdaM ? "EBITDA" : "EBT / Dobiček pred davki") + " (mio €)",
            data: hist.map((h) => h.ebitdaM !== null ? h.ebitdaM : h.ebitM),
            backgroundColor: "rgba(99, 102, 241, 0.85)",
            borderRadius: 3
          },
          {
            label: "Čisti dobiček (mio €)",
            data: hist.map((h) => h.netIncomeM),
            backgroundColor: "#10b981",
            borderRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });

    // Chart 2B: ROE, ROIC & Net Margin (2016-2025)
    renderChart("marginsRoe10Y", "chartMarginsRoe10Y", {
      type: "line",
      data: {
        labels: years,
        datasets: [
          {
            label: "ROE — Donosnost kapitala (%)",
            data: hist.map((h) => h.roePct),
            borderColor: "#10b981",
            backgroundColor: "rgba(16,185,129,0.1)",
            borderWidth: 2.5,
            tension: 0.25,
            fill: true
          },
          {
            label: "Čista dobičkovna marža (%)",
            data: hist.map((h) => h.netMarginPct),
            borderColor: "#38bdf8",
            borderWidth: 2.2,
            tension: 0.25
          },
          {
            label: hist[9].ebitdaMarginPct ? "EBITDA marža (%)" : "ROA — Donosnost sredstev (%)",
            data: hist.map((h) => h.ebitdaMarginPct !== null ? h.ebitdaMarginPct : h.roaPct),
            borderColor: "#f59e0b",
            borderDash: [4, 3],
            borderWidth: 2,
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: {
            ticks: { color: "#94a3b8", callback: (v) => v + " %" },
            grid: { color: "rgba(148,163,184,0.08)" }
          }
        }
      }
    });

    // Chart 2C: EPS, DPS & Year-End Share Price (2016-2026)
    const yearsPlus26 = [...years, "2026"];
    const epsSeries = [...hist.map((h) => h.eps), cur.eps];
    const dpsSeries = [...hist.map((h) => h.dps), cur.dps];
    const pxSeries = [...hist.map((h) => h.closePrice), cur.price];

    renderChart("epsDpsPrice10Y", "chartEpsDpsPrice10Y", {
      type: "bar",
      data: {
        labels: yearsPlus26,
        datasets: [
          {
            type: "bar",
            label: "Čisti dobiček na delnico — EPS (€)",
            data: epsSeries,
            backgroundColor: "rgba(56, 189, 248, 0.75)",
            yAxisID: "y",
            borderRadius: 3
          },
          {
            type: "bar",
            label: "Dividenda na delnico — DPS (€)",
            data: dpsSeries,
            backgroundColor: "#10b981",
            yAxisID: "y",
            borderRadius: 3
          },
          {
            type: "line",
            label: "Tečaj delnice (€, desna os)",
            data: pxSeries,
            borderColor: "#f59e0b",
            backgroundColor: "transparent",
            borderWidth: 2.5,
            yAxisID: "y1",
            tension: 0.25,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: {
            position: "left",
            ticks: { color: "#38bdf8", callback: (v) => v + " €" },
            grid: { color: "rgba(148,163,184,0.08)" }
          },
          y1: {
            position: "right",
            ticks: { color: "#f59e0b", callback: (v) => v + " €" },
            grid: { display: false }
          }
        }
      }
    });

    // Full 10-Year Financial Table (2016–2025 + 2026 TTM + 10Y CAGR)
    document.getElementById("finProformaBadge").textContent =
      "Uradni revidirani MSRP izkazi (SEOnet 2016–2025 + 2026 TTM)";

    const thead = document.getElementById("historicalFinancialsHead");
    thead.innerHTML = `
      <tr>
        <th>Finančni kazalnik / Leto</th>
        ${hist.map((h) => `<th>${h.year}${h.isProForma ? "*" : ""}</th>`).join("")}
        <th style="color:var(--accent-blue);">2026 TTM</th>
        <th style="color:var(--accent-emerald);">10L CAGR</th>
      </tr>
    `;

    const rowsSpec = [
      { divider: "Izkaz poslovnega izida in denarni tokovi (v mio €)" },
      { label: comp.revenueLabel + " (mio €)", key: "revenueM", curr: cur.revenueM, cagr: cagrs.revenueCagrPct, dec: 1, bold: true },
      { label: "EBITDA (mio €)", key: "ebitdaM", curr: cur.ebitdaM, cagr: cagrs.ebitdaCagrPct, dec: 1 },
      { label: "EBIT / Dobiček pred davki (mio €)", key: "ebitM", curr: cur.ebitM, cagr: null, dec: 1 },
      { label: "Čisti poslovni izid (mio €)", key: "netIncomeM", curr: cur.netIncomeM, cagr: cagrs.netIncomeCagrPct, dec: 2, bold: true },
      { label: "Denarni tok iz poslovanja — OCF (mio €)", key: "operatingCashFlowM", curr: hist[9].operatingCashFlowM, cagr: null, dec: 1 },
      { label: "Investicije — CAPEX (mio €)", key: "capexM", curr: hist[9].capexM, cagr: null, dec: 1 },
      { label: comp.fcfLabel + " (mio €)", key: "fcfM", curr: cur.fcfM, cagr: null, dec: 1, bold: true },

      { divider: "Bilanca stanja in zaposlenost (v mio €)" },
      { label: "Celotna sredstva / Bilančna vsota (mio €)", key: "assetsM", curr: cur.assetsM, cagr: null, dec: 1 },
      { label: "Kapital delničarjev (mio €)", key: "equityM", curr: cur.equityM, cagr: cagrs.equityCagrPct, dec: 1, bold: true },
      { label: "Denarna sredstva (mio €)", key: "cashM", curr: hist[9].cashM, cagr: null, dec: 1 },
      { label: "Čisti finančni dolg / (-Neto denar) (mio €)", key: "netDebtM", curr: cur.netDebtM, cagr: null, dec: 1 },
      { label: "Število zaposlenih", key: "employees", curr: hist[9].employees, cagr: null, dec: 0 },

      { divider: "Kazalniki na delnico in dobičkonosnost" },
      { label: "Zaključni tečaj delnice (€)", key: "closePrice", curr: cur.price, cagr: cagrs.priceCagrPct, dec: 2, suffix: " €", bold: true },
      { label: "Čisti dobiček na delnico — EPS (€)", key: "eps", curr: cur.eps, cagr: cagrs.netIncomeCagrPct, dec: 2, suffix: " €" },
      { label: "Dividenda na delnico — DPS (€)", key: "dps", curr: cur.dps, cagr: cagrs.dpsCagrPct, dec: 2, suffix: " €", bold: true },
      { label: "Knjigovodska vrednost na delnico — BVPS (€)", key: "bvps", curr: cur.bvps, cagr: cagrs.equityCagrPct, dec: 2, suffix: " €" },
      { label: "Donosnost kapitala — ROE (%)", key: "roePct", curr: cur.roePct, cagr: null, dec: 1, suffix: " %" },
      { label: "Donosnost investiranega kapitala — ROIC (%)", key: "roicPct", curr: cur.roicPct, cagr: null, dec: 1, suffix: " %" },
      { label: "EBITDA marža (%)", key: "ebitdaMarginPct", curr: cur.ebitdaMarginPct, cagr: null, dec: 1, suffix: " %" },
      { label: "Čista dobičkovna marža (%)", key: "netMarginPct", curr: cur.netMarginPct, cagr: null, dec: 1, suffix: " %" },

      { divider: "Zgodovinski večkratniki vrednotenja ob koncu leta" },
      { label: "P/E (Cena / Dobiček)", key: "pe", curr: cur.pe, cagr: null, dec: 2, suffix: "x", bold: true },
      { label: "P/B (Cena / Knjigovodska vrednost)", key: "pb", curr: cur.pb, cagr: null, dec: 2, suffix: "x" },
      { label: "EV/EBITDA", key: "evEbitda", curr: cur.evEbitda, cagr: null, dec: 2, suffix: "x" },
      { label: "P/S (Cena / Prihodki)", key: "ps", curr: cur.ps, cagr: null, dec: 2, suffix: "x" },
      { label: "Dividendna donosnost (%)", key: "divYieldPct", curr: cur.divYieldPct, cagr: null, dec: 2, suffix: " %", bold: true }
    ];

    const tbody = document.getElementById("historicalFinancialsBody");
    tbody.innerHTML = rowsSpec
      .map((r) => {
        if (r.divider) {
          return `<tr class="section-divider"><td colspan="13">${r.divider}</td></tr>`;
        }
        const rowClass = r.bold ? "highlight-row" : "";
        const sfx = r.suffix || "";
        return `
          <tr class="${rowClass}">
            <td class="label-cell">${r.label}</td>
            ${hist.map((h) => `<td>${fmtNum(h[r.key], r.dec, sfx)}</td>`).join("")}
            <td style="color:var(--accent-blue);font-weight:700;">${fmtNum(r.curr, r.dec, sfx)}</td>
            <td style="color:var(--accent-emerald);font-weight:700;">${r.cagr !== null && r.cagr !== undefined ? fmtSignedPct(r.cagr, 1) : "—"}</td>
          </tr>
        `;
      })
      .join("");

    // Breakdowns, Catalysts/Risks & Top Shareholders Cards
    const bGrid = document.getElementById("companyBreakdownsGrid");
    const catBreakdown = comp.breakdowns.find((b) => b.axis === "category") || comp.breakdowns[0];
    const geoBreakdown = comp.breakdowns.find((b) => b.axis === "geography") || comp.breakdowns[1];
    const owners = (comp.ownership && comp.ownership.owners) || [];

    const renderBreakdownList = (bObj, fallbackTitle) => {
      if (!bObj || !bObj.items || !bObj.items.length) {
        return `<div class="text-muted" style="font-size:12.5px;">Podrobna segmentacija je vključena v konsolidiranem letnem poročilu (${fallbackTitle}).</div>`;
      }
      return bObj.items
        .slice(0, 6)
        .map(
          (it) => `
          <div style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
              <span style="color:var(--text-primary);font-weight:500;">${it.label}</span>
              <span class="mono">${fmtNum(it.valueM, 1)} mio € (${fmtNum(it.sharePct, 1)} %)</span>
            </div>
            <div class="pillar-track"><div class="pillar-bar" style="width:${Math.min(100, it.sharePct || 10)}%;"></div></div>
          </div>
        `
        )
        .join("");
    };

    bGrid.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Struktura prihodkov po segmentih in trgih (2025)</div>
            <div class="card-subtitle">Vir: Revidirano letno poročilo 2025</div>
          </div>
        </div>
        ${renderBreakdownList(catBreakdown, comp.sector)}
        ${geoBreakdown ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle);"><div style="font-size:11.5px;font-weight:700;color:var(--accent-blue);margin-bottom:8px;">GEOGRAFSKA STRUKTURA TRGOV</div>${renderBreakdownList(geoBreakdown, "Regija Adria & EU")}</div>` : ""}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Ključni katalizatorji rasti in tveganja</div>
            <div class="card-subtitle">Strateški dejavniki za obdobje 2026–2030</div>
          </div>
        </div>
        <div style="margin-bottom:12px;">
          <div style="font-size:11.5px;font-weight:700;color:#34d399;text-transform:uppercase;margin-bottom:6px;">Katalizatorji ustvarjanja vrednosti</div>
          <ul style="padding-left:16px;font-size:12.5px;color:var(--text-secondary);display:flex;flex-direction:column;gap:5px;">
            ${comp.thesis.catalysts.map((c) => `<li>${c}</li>`).join("")}
          </ul>
        </div>
        <div style="padding-top:10px;border-top:1px solid var(--border-subtle);">
          <div style="font-size:11.5px;font-weight:700;color:#fb7185;text-transform:uppercase;margin-bottom:6px;">Ključna tveganja poslovanja</div>
          <ul style="padding-left:16px;font-size:12.5px;color:var(--text-secondary);display:flex;flex-direction:column;gap:5px;">
            ${comp.thesis.risks.map((r) => `<li>${r}</li>`).join("")}
          </ul>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Največji delničarji družbe (${comp.ownership.asOf || "2026"})</div>
            <div class="card-subtitle">${comp.ownership.sourceLabel || "Centralna klirinško depotna družba (KDD)"}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:7px;">
          ${owners
            .slice(0, 8)
            .map(
              (o, i) => `
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:5px 8px;background:rgba(10,15,24,0.55);border-radius:4px;">
                <span style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:74%;"><strong class="mono text-muted">${i + 1}.</strong> ${o.name}</span>
                <span class="badge badge-blue">${fmtNum(o.sharePct, 2)} %</span>
              </div>
            `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // MODULE 3: INTERACTIVE DCF & FAIR VALUE SIMULATOR
  // =========================================================================
  function loadSimulatorDefaultsForCompany(comp, preset = "base") {
    const d = comp.dcfDefaults;
    let multG1 = 1.0;
    let multG2 = 1.0;
    let waccAdj = 0.0;
    let termAdj = 0.0;

    if (preset === "bear") {
      multG1 = 0.55;
      multG2 = 0.6;
      waccAdj = 1.0;
      termAdj = -0.5;
    } else if (preset === "bull") {
      multG1 = 1.35;
      multG2 = 1.3;
      waccAdj = -0.6;
      termAdj = 0.5;
    }

    simState = {
      baseCashFlowM: d.baseCashFlowM,
      growthStage1Pct: Number((d.growthStage1Pct * multG1).toFixed(1)),
      growthStage2Pct: Number((d.growthStage2Pct * multG2).toFixed(1)),
      waccPct: Number((d.waccPct + waccAdj).toFixed(1)),
      terminalGrowthPct: Number(Math.max(0.5, d.terminalGrowthPct + termAdj).toFixed(1)),
      exitMultiple: d.exitMultiple,
      terminalMethod: document.getElementById("selTerminalMethod").value || "gordon",
      mosPct: d.mosPct,
      netDebtM: d.netDebtM,
      sharesM: d.sharesM,
      activePreset: preset
    };

    // Update slider min/max dynamically for baseCashFlowM based on company scale
    const rngCf = document.getElementById("rngBaseCf");
    const maxCf = Math.max(25, Math.ceil(d.baseCashFlowM * 2.5));
    rngCf.min = Math.max(0.5, Math.floor(d.baseCashFlowM * 0.2));
    rngCf.max = maxCf;
    rngCf.step = d.baseCashFlowM < 30 ? 0.2 : 1.0;

    syncSimulatorInputsFromState(comp);
    renderSimulatorOutputs(comp);
  }

  function syncSimulatorInputsFromState(comp) {
    document.getElementById("numBaseCf").value = simState.baseCashFlowM;
    document.getElementById("rngBaseCf").value = simState.baseCashFlowM;
    document.getElementById("numGrowth1").value = simState.growthStage1Pct;
    document.getElementById("rngGrowth1").value = simState.growthStage1Pct;
    document.getElementById("numGrowth2").value = simState.growthStage2Pct;
    document.getElementById("rngGrowth2").value = simState.growthStage2Pct;
    document.getElementById("numWacc").value = simState.waccPct;
    document.getElementById("rngWacc").value = simState.waccPct;
    document.getElementById("numTermG").value = simState.terminalGrowthPct;
    document.getElementById("rngTermG").value = simState.terminalGrowthPct;
    document.getElementById("numExitMult").value = simState.exitMultiple;
    document.getElementById("rngExitMult").value = simState.exitMultiple;
    document.getElementById("numMos").value = simState.mosPct;
    document.getElementById("rngMos").value = simState.mosPct;
    document.getElementById("numNetDebt").value = simState.netDebtM;

    document.getElementById("hintBaseCfType").textContent = comp.fcfLabel;
    document.getElementById("hintBaseCfPerShare").textContent =
      `${fmtNum(simState.baseCashFlowM / simState.sharesM, 2)} € / delnico`;
    document.getElementById("hintSharesCount").textContent =
      `Delnice: ${fmtNum(simState.sharesM, 3)} mio`;

    ["Bear", "Base", "Bull"].forEach((p) => {
      const btn = document.getElementById("btnPreset" + p);
      if (btn) {
        btn.classList.toggle("active", simState.activePreset === p.toLowerCase());
      }
    });
  }

  function renderSimulatorOutputs(comp) {
    const price = comp.current.price;
    document.getElementById("simSectionTitle").textContent =
      `${comp.shortName} (${comp.ticker}) — Interaktivni simulator projekcij in izračun poštene vrednosti delnice`;
    document.getElementById("simModelTypeBadge").textContent = comp.valuationModelType;
    document.getElementById("sensCurrentPriceBadge").textContent = `Borzni tečaj (${comp.ticker}): ${fmtNum(price, 2)} €`;

    const res = computeDcfModel(simState, price);

    // Status verdict
    let verdictText = "POŠTENO VREDNOTENO";
    let verdictBadge = "badge-amber";
    if (res.upsidePct >= 12) {
      verdictText = "PODCENJENO (NAKUPNA PRILOŽNOST)";
      verdictBadge = "badge-emerald";
    } else if (res.upsidePct <= -12) {
      verdictText = "PRECENJENO GLEDE NA DCF";
      verdictBadge = "badge-rose";
    }

    const pvBreakdownNote = `<div class="kpi-sub">PV denarnih tokov (10L): <strong>${fmtNum(res.sumPvCfM, 1)} mio €</strong> · PV Term.: <strong>${fmtNum(res.pvTerminalM, 1)} mio €</strong></div>`;

    document.getElementById("simResultCards").innerHTML = `
      <div class="val-box primary">
        <div class="kpi-label"><span>Izračunana poštena vrednost (DCF)</span><span class="badge ${verdictBadge}">${verdictText}</span></div>
        <div class="kpi-value" style="color:#34d399;font-size:26px;">${fmtNum(res.fairValuePerShare, 2)} €</div>
        ${pvBreakdownNote}
      </div>
      <div class="val-box">
        <div class="kpi-label"><span>Trenutni borzni tečaj (${comp.ticker})</span><span class="badge badge-neutral">LJSE</span></div>
        <div class="kpi-value">${fmtNum(price, 2)} €</div>
        <div class="kpi-sub">Tržna kap. (brez lastnih delnic): <strong>${fmtNum(comp.current.effectiveMarketCapM, 1)} mio €</strong></div>
      </div>
      <div class="val-box">
        <div class="kpi-label"><span>Potencial rasti / Diskont</span><span class="badge ${res.upsidePct >= 0 ? "badge-emerald" : "badge-rose"}">${fmtSignedPct(res.upsidePct, 1)}</span></div>
        <div class="kpi-value ${res.upsidePct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(res.upsidePct, 2)}</div>
        <div class="kpi-sub">Implicirana varnostna rezerva: <strong>${fmtSignedPct(res.impliedMosPct, 1)}</strong></div>
      </div>
      <div class="val-box">
        <div class="kpi-label"><span>Ciljna nakupna cena (z ${fmtNum(simState.mosPct, 0)} % MoS)</span><span class="badge badge-blue">Varnostna meja</span></div>
        <div class="kpi-value text-blue">${fmtNum(res.buyPriceWithMos, 2)} €</div>
        <div class="kpi-sub">Notranja vrednost kapitala: <strong>${fmtNum(res.equityValueM, 1)} mio €</strong></div>
      </div>
    `;

    // Chart 3A: 10-Year Projected Cash Flows vs Present Value
    renderChart("dcfProj", "chartDcfProjection", {
      type: "bar",
      data: {
        labels: res.years.map((y) => y.calendarYear + "E"),
        datasets: [
          {
            label: "Projicirani prosti denarni tok (mio €)",
            data: res.years.map((y) => Number(y.cashFlowM.toFixed(2))),
            backgroundColor: "rgba(56, 189, 248, 0.8)",
            borderRadius: 4
          },
          {
            label: "Diskontirana sedanja vrednost — PV (mio €)",
            data: res.years.map((y) => Number(y.pvCashFlowM.toFixed(2))),
            backgroundColor: "#10b981",
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: { ticks: { color: "#94a3b8", callback: (v) => v + " M€" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });

    // 3 Scenarios Comparison Table (Bear / Simulated Base / Bull)
    const bearRes = computeDcfModel({
      ...simState,
      growthStage1Pct: simState.growthStage1Pct * 0.6,
      growthStage2Pct: simState.growthStage2Pct * 0.6,
      waccPct: simState.waccPct + 1.0,
      terminalGrowthPct: Math.max(0.5, simState.terminalGrowthPct - 0.5)
    }, price);

    const bullRes = computeDcfModel({
      ...simState,
      growthStage1Pct: simState.growthStage1Pct * 1.35,
      growthStage2Pct: simState.growthStage2Pct * 1.3,
      waccPct: Math.max(5.5, simState.waccPct - 0.6),
      terminalGrowthPct: Math.min(4.0, simState.terminalGrowthPct + 0.5)
    }, price);

    document.getElementById("simScenariosTableWrap").innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Scenarij</th>
              <th>Rast 1–5L</th>
              <th>Rast 6–10L</th>
              <th>WACC</th>
              <th>Term. g</th>
              <th>Vrednost kapitala</th>
              <th>Poštena vr. (€)</th>
              <th>Razlika vs. Tečaj</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="label-cell"><span class="badge badge-rose">Pesimistični</span></td>
              <td>${fmtNum(simState.growthStage1Pct * 0.6, 1)} %</td>
              <td>${fmtNum(simState.growthStage2Pct * 0.6, 1)} %</td>
              <td>${fmtNum(simState.waccPct + 1.0, 1)} %</td>
              <td>${fmtNum(Math.max(0.5, simState.terminalGrowthPct - 0.5), 1)} %</td>
              <td>${fmtNum(bearRes.equityValueM, 1)} M€</td>
              <td><strong>${fmtNum(bearRes.fairValuePerShare, 2)} €</strong></td>
              <td class="${bearRes.upsidePct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(bearRes.upsidePct, 1)}</td>
            </tr>
            <tr class="highlight-row">
              <td class="label-cell"><span class="badge badge-blue">Aktivna simulacija</span></td>
              <td>${fmtNum(simState.growthStage1Pct, 1)} %</td>
              <td>${fmtNum(simState.growthStage2Pct, 1)} %</td>
              <td>${fmtNum(simState.waccPct, 1)} %</td>
              <td>${fmtNum(simState.terminalGrowthPct, 1)} %</td>
              <td>${fmtNum(res.equityValueM, 1)} M€</td>
              <td><strong class="text-emerald">${fmtNum(res.fairValuePerShare, 2)} €</strong></td>
              <td class="${res.upsidePct >= 0 ? "text-emerald" : "text-rose"}"><strong>${fmtSignedPct(res.upsidePct, 1)}</strong></td>
            </tr>
            <tr>
              <td class="label-cell"><span class="badge badge-emerald">Optimistični</span></td>
              <td>${fmtNum(simState.growthStage1Pct * 1.35, 1)} %</td>
              <td>${fmtNum(simState.growthStage2Pct * 1.3, 1)} %</td>
              <td>${fmtNum(Math.max(5.5, simState.waccPct - 0.6), 1)} %</td>
              <td>${fmtNum(Math.min(4.0, simState.terminalGrowthPct + 0.5), 1)} %</td>
              <td>${fmtNum(bullRes.equityValueM, 1)} M€</td>
              <td><strong>${fmtNum(bullRes.fairValuePerShare, 2)} €</strong></td>
              <td class="${bullRes.upsidePct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(bullRes.upsidePct, 1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style="margin-top:12px;font-size:12px;color:var(--text-secondary);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span>Vsota PV denarnih tokov (1–10L): <strong class="mono text-primary">${fmtNum(res.sumPvCfM, 1)} mio € (${fmtNum(100 - res.tvShareOfEvPct, 1)} %)</strong></span>
        <span>Sedanja vrednost terminalne vr. (PV TV): <strong class="mono text-primary">${fmtNum(res.pvTerminalM, 1)} mio € (${fmtNum(res.tvShareOfEvPct, 1)} %)</strong></span>
      </div>
    `;

    // 10-Year Projection Table
    document.getElementById("simProjectionTable").innerHTML = `
      <thead>
        <tr>
          <th>Postavka projekcije</th>
          <th>Izhodišče</th>
          ${res.years.map((y) => `<th>${y.calendarYear}E (L${y.step})</th>`).join("")}
          <th>Terminalna vr.</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="label-cell">Letna stopnja rasti (%)</td>
          <td>—</td>
          ${res.years.map((y) => `<td>${fmtNum(y.growthPct, 1)} %</td>`).join("")}
          <td>${fmtNum(simState.terminalGrowthPct, 1)} % (trajno)</td>
        </tr>
        <tr class="highlight-row">
          <td class="label-cell">Projicirani denarni tok (mio €)</td>
          <td>${fmtNum(simState.baseCashFlowM, 2)}</td>
          ${res.years.map((y) => `<td>${fmtNum(y.cashFlowM, 2)}</td>`).join("")}
          <td>${fmtNum(res.terminalValueM, 1)}</td>
        </tr>
        <tr>
          <td class="label-cell">Diskontni faktor (WACC ${fmtNum(simState.waccPct, 1)} %)</td>
          <td>1,000</td>
          ${res.years.map((y) => `<td>${fmtNum(y.discountFactor, 3)}</td>`).join("")}
          <td>${fmtNum(res.years[9].discountFactor, 3)}</td>
        </tr>
        <tr>
          <td class="label-cell">Sedanja vrednost — PV (mio €)</td>
          <td>—</td>
          ${res.years.map((y) => `<td class="text-emerald">${fmtNum(y.pvCashFlowM, 2)}</td>`).join("")}
          <td class="text-blue"><strong>${fmtNum(res.pvTerminalM, 1)}</strong></td>
        </tr>
        <tr>
          <td class="label-cell">Denarni tok na delnico (€/deln.)</td>
          <td>${fmtNum(simState.baseCashFlowM / simState.sharesM, 2)} €</td>
          ${res.years.map((y) => `<td>${fmtNum(y.cashFlowM / simState.sharesM, 2)} €</td>`).join("")}
          <td><strong>Poštena vr.: ${fmtNum(res.fairValuePerShare, 2)} €</strong></td>
        </tr>
      </tbody>
    `;

    // 2D Sensitivity Matrix: WACC (rows) vs Terminal Growth g (columns)
    const waccSteps = [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5].map((d) =>
      Number(Math.max(4.5, simState.waccPct + d).toFixed(1))
    );
    const gSteps = [-1.0, -0.5, 0.0, 0.5, 1.0].map((d) =>
      Number(Math.max(0.0, simState.terminalGrowthPct + d).toFixed(1))
    );

    let sensHtml = `
      <thead>
        <tr>
          <th>WACC \\ Terminalna rast (g)</th>
          ${gSteps.map((g) => `<th>g = ${fmtNum(g, 1)} %</th>`).join("")}
        </tr>
      </thead>
      <tbody>
    `;

    waccSteps.forEach((wVal) => {
      sensHtml += `<tr><td class="label-cell"><strong>WACC = ${fmtNum(wVal, 1)} %</strong></td>`;
      gSteps.forEach((gVal) => {
        const cellRes = computeDcfModel(
          {
            ...simState,
            waccPct: wVal,
            terminalGrowthPct: gVal
          },
          price
        );
        const fv = cellRes.fairValuePerShare;
        const diffPct = ((fv - price) / price) * 100;
        let cellClass = "sens-cell-fair";
        if (diffPct >= 8) cellClass = "sens-cell-undervalued";
        else if (diffPct <= -8) cellClass = "sens-cell-overvalued";

        const isCenter =
          Math.abs(wVal - simState.waccPct) < 0.05 &&
          Math.abs(gVal - simState.terminalGrowthPct) < 0.05
            ? "sens-cell-active"
            : "";

        sensHtml += `<td class="${cellClass} ${isCenter}">${fmtNum(fv, 2)} € <span style="font-size:10.5px;opacity:0.85;">(${fmtSignedPct(diffPct, 0)})</span></td>`;
      });
      sensHtml += `</tr>`;
    });
    sensHtml += `</tbody>`;
    document.getElementById("simSensitivityTable").innerHTML = sensHtml;
  }

  // =========================================================================
  // MODULE 4: INTERNATIONAL PEER COMPARISON
  // =========================================================================
  function renderModule4Peers(comp) {
    const cur = comp.current;
    const pc = comp.peerComparison;

    document.getElementById("peerSectionTitle").textContent =
      `${comp.shortName} (${comp.ticker}) — Primerjava kazalnikov vrednotenj s primerljivimi podjetji v tujini`;

    const contentEl = document.getElementById("peerModuleContent");

    if (pc && pc.included) {
      const premPe = pc.premiumVsPeerMedianPct.pe;
      const badgeClass = premPe <= 0 ? "badge-emerald" : "badge-amber";
      const badgeText =
        premPe <= 0
          ? `Trguje z diskontom (${fmtSignedPct(premPe, 1)} vs. Mediana tujih P/E)`
          : `Trguje s premijo (${fmtSignedPct(premPe, 1)} vs. Mediana tujih P/E)`;

      document.getElementById("peerStatusBadgeWrap").innerHTML = `<span class="badge ${badgeClass}">${badgeText}</span>`;

      const med = pc.peerMedian;
      const avg = pc.peerAverage;
      const imp = pc.impliedPrices || {};

      const fmtDiffBadge = (val, invertColor = false) => {
        if (val === null || val === undefined) return "—";
        const isGood = invertColor ? val >= 0 : val <= 0;
        return `<span class="badge ${isGood ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(val, 1)}</span>`;
      };

      contentEl.innerHTML = `
        <div class="grid-2" style="margin-bottom:16px;">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Primerjalna tabela: ${comp.shortName} (${comp.ticker}) vs. 5 tujih primerljivih družb</div>
                <div class="card-subtitle">Sektor: ${comp.sector} · Vrednotenjski večkratniki in dobičkonosnost</div>
              </div>
            </div>
            <div class="table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Podjetje (Simbol)</th>
                    <th>Država</th>
                    <th>Tržna kap. (mrd €)</th>
                    <th>P/E (TTM)</th>
                    <th>Fwd P/E</th>
                    <th>P/B</th>
                    <th>EV/EBITDA</th>
                    <th>P/S</th>
                    <th>Div. donos</th>
                    <th>ROE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="highlight-row">
                    <td class="label-cell"><strong class="text-blue">${comp.shortName} (${comp.ticker})</strong></td>
                    <td style="text-align:left;font-family:var(--font-sans);">Slovenija (SI)</td>
                    <td>${fmtNum(cur.marketCapM / 1000, 2)}</td>
                    <td><strong>${fmtNum(cur.pe, 2)}x</strong></td>
                    <td>${fmtNum(cur.pe * 0.93, 2)}x</td>
                    <td><strong>${fmtNum(cur.pb, 2)}x</strong></td>
                    <td>${cur.evEbitda ? fmtNum(cur.evEbitda, 2) + "x" : "—"}</td>
                    <td>${fmtNum(cur.ps, 2)}x</td>
                    <td class="text-emerald"><strong>${fmtNum(cur.divYieldPct, 2)} %</strong></td>
                    <td><strong>${fmtNum(cur.roePct, 1)} %</strong></td>
                  </tr>
                  ${pc.peers
                    .map(
                      (p) => `
                    <tr>
                      <td class="label-cell">${p.name} <span class="mono text-muted">(${p.ticker})</span></td>
                      <td style="text-align:left;font-family:var(--font-sans);color:var(--text-secondary);">${p.country}</td>
                      <td>${fmtNum(p.marketCapEurBn, 2)}</td>
                      <td>${fmtNum(p.pe, 2)}x</td>
                      <td>${fmtNum(p.forwardPe, 2)}x</td>
                      <td>${fmtNum(p.pb, 2)}x</td>
                      <td>${p.evEbitda ? fmtNum(p.evEbitda, 2) + "x" : "—"}</td>
                      <td>${fmtNum(p.ps, 2)}x</td>
                      <td>${fmtNum(p.divYieldPct, 2)} %</td>
                      <td>${fmtNum(p.roePct, 1)} %</td>
                    </tr>
                  `
                    )
                    .join("")}
                  <tr class="section-divider"><td colspan="10">Statistika tuje primerjalne skupine (Peer Group Benchmark)</td></tr>
                  <tr>
                    <td class="label-cell"><strong>Povprečje tujih podjetij (Peer Mean)</strong></td>
                    <td style="text-align:left;">Mednarodno</td>
                    <td>—</td>
                    <td><strong>${fmtNum(avg.pe, 2)}x</strong></td>
                    <td>${fmtNum(avg.forwardPe, 2)}x</td>
                    <td><strong>${fmtNum(avg.pb, 2)}x</strong></td>
                    <td>${avg.evEbitda ? fmtNum(avg.evEbitda, 2) + "x" : "—"}</td>
                    <td>${fmtNum(avg.ps, 2)}x</td>
                    <td>${fmtNum(avg.divYieldPct, 2)} %</td>
                    <td>${fmtNum(avg.roePct, 1)} %</td>
                  </tr>
                  <tr class="highlight-row">
                    <td class="label-cell"><strong>Mediana tujih podjetij (Peer Median)</strong></td>
                    <td style="text-align:left;">Mednarodno</td>
                    <td>—</td>
                    <td><strong>${fmtNum(med.pe, 2)}x</strong></td>
                    <td>${fmtNum(med.forwardPe, 2)}x</td>
                    <td><strong>${fmtNum(med.pb, 2)}x</strong></td>
                    <td>${med.evEbitda ? fmtNum(med.evEbitda, 2) + "x" : "—"}</td>
                    <td>${fmtNum(med.ps, 2)}x</td>
                    <td>${fmtNum(med.divYieldPct, 2)} %</td>
                    <td>${fmtNum(med.roePct, 1)} %</td>
                  </tr>
                  <tr>
                    <td class="label-cell"><strong>Odstopanje ${comp.ticker} vs. Mediana tujih</strong></td>
                    <td style="text-align:left;">Premija (+) / Diskont (-)</td>
                    <td>—</td>
                    <td>${fmtDiffBadge(pc.premiumVsPeerMedianPct.pe)}</td>
                    <td>${fmtDiffBadge(pc.premiumVsPeerMedianPct.forwardPe)}</td>
                    <td>${fmtDiffBadge(pc.premiumVsPeerMedianPct.pb)}</td>
                    <td>${fmtDiffBadge(pc.premiumVsPeerMedianPct.evEbitda)}</td>
                    <td>${fmtDiffBadge(pc.premiumVsPeerMedianPct.ps)}</td>
                    <td>${fmtDiffBadge(pc.premiumVsPeerMedianPct.divYieldPct, true)}</td>
                    <td>${fmtDiffBadge(pc.premiumVsPeerMedianPct.roePct, true)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:16px;">
            <div class="card">
              <div class="card-header">
                <div>
                  <div class="card-title">Vizualna primerjava večkratnikov: ${comp.ticker} vs. Tuje primerljive družbe</div>
                  <div class="card-subtitle">Primerjava P/E, P/B, EV/EBITDA in Dividendne donosnosti (%)</div>
                </div>
              </div>
              <div class="chart-box-sm">
                <canvas id="chartPeerComparison"></canvas>
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <div>
                  <div class="card-title">Implicirana vrednost delnice ${comp.ticker} ob večkratnikih tujih vrstnikov</div>
                  <div class="card-subtitle">Koliko bi znašal tečaj delnice ${comp.shortName}, če bi se trgovala pri mediani tujih tekmecev</div>
                </div>
              </div>
              <div class="grid-3">
                <div class="val-box">
                  <div class="kpi-label"><span>Cena ob Peer Mediani P/E (${fmtNum(med.pe, 1)}x)</span></div>
                  <div class="kpi-value">${fmtNum(imp.byPeerMedianPe, 2)} €</div>
                  <div class="kpi-sub">Trenutni tečaj: <strong>${fmtNum(cur.price, 2)} €</strong></div>
                </div>
                <div class="val-box">
                  <div class="kpi-label"><span>Cena ob Peer Mediani P/B (${fmtNum(med.pb, 2)}x)</span></div>
                  <div class="kpi-value">${fmtNum(imp.byPeerMedianPb, 2)} €</div>
                  <div class="kpi-sub">Knjigovodska vr.: <strong>${fmtNum(cur.bvps, 2)} €</strong></div>
                </div>
                <div class="val-box">
                  <div class="kpi-label"><span>Povprečna Peer implicirana cena</span></div>
                  <div class="kpi-value text-blue">${fmtNum(imp.blendedPeerFairValue, 2)} €</div>
                  <div class="kpi-sub">Razlika vs. trg: <strong>${fmtSignedPct(imp.blendedUpsidePct, 1)}</strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      // Render Peer Comparison Bar Chart
      const labels = [comp.ticker + " (SI)", ...pc.peers.map((p) => p.ticker), "Mediana tujih"];
      renderChart("peerComp", "chartPeerComparison", {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "P/E (x)",
              data: [cur.pe, ...pc.peers.map((p) => p.pe), med.pe],
              backgroundColor: labels.map((_, i) => (i === 0 ? "#38bdf8" : i === labels.length - 1 ? "#10b981" : "rgba(148, 163, 184, 0.55)")),
              borderRadius: 4
            },
            {
              label: "Dividendna donosnost (%)",
              data: [cur.divYieldPct, ...pc.peers.map((p) => p.divYieldPct), med.divYieldPct],
              backgroundColor: "rgba(245, 158, 11, 0.8)",
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11 } } } },
          scales: {
            x: { ticks: { color: "#cbd5e1", font: { size: 11 } }, grid: { display: false } },
            y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } }
          }
        }
      });
    }

    // Cross-Index Peer Summary Matrix (All 9 companies)
    const crossBody = document.getElementById("crossPeerSummaryBody");
    crossBody.innerHTML = DATA.companies
      .filter((c) => c.includedInPeerComparison)
      .map((c) => {
        const curC = c.current;
        const pcC = c.peerComparison;
        const medC = pcC.peerMedian;
        const premC = pcC.premiumVsPeerMedianPct;
        const isSel = c.ticker === selectedTicker ? "highlight-row" : "";

        const badge = (v) =>
          v !== null && v !== undefined
            ? `<span class="badge ${v <= 0 ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(v, 1)}</span>`
            : "—";

        return `
          <tr class="${isSel}" data-ticker="${c.ticker}" style="cursor:pointer;">
            <td class="label-cell"><strong class="mono text-blue">${c.ticker}</strong> · ${c.shortName}</td>
            <td>${fmtNum(curC.price, 2)} €</td>
            <td><strong>${fmtNum(curC.pe, 2)}x</strong></td>
            <td>${fmtNum(medC.pe, 2)}x</td>
            <td>${badge(premC.pe)}</td>
            <td><strong>${fmtNum(curC.pb, 2)}x</strong></td>
            <td>${fmtNum(medC.pb, 2)}x</td>
            <td>${badge(premC.pb)}</td>
            <td>${curC.evEbitda ? fmtNum(curC.evEbitda, 2) + "x" : "—"}</td>
            <td>${medC.evEbitda ? fmtNum(medC.evEbitda, 2) + "x" : "—"}</td>
            <td>${badge(premC.evEbitda)}</td>
            <td><strong class="text-emerald">${fmtNum(curC.divYieldPct, 2)} %</strong> vs. ${fmtNum(medC.divYieldPct, 2)} %</td>
            <td><strong>${fmtNum(curC.roePct, 1)} %</strong> vs. ${fmtNum(medC.roePct, 1)} %</td>
            <td><strong>${fmtNum(pcC.impliedPrices.byPeerMedianPe, 2)} €</strong></td>
          </tr>
        `;
      })
      .join("");

    crossBody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => selectCompany(tr.getAttribute("data-ticker")));
    });
  }

  // =========================================================================
  // MODULE 5: HISTORICAL SELF-VALUATION COMPARISON (10-YEAR HISTORY)
  // =========================================================================
  function renderModule5HistoricalValuation(comp) {
    const hv = comp.historicalValuation;
    document.getElementById("histValSectionTitle").textContent =
      `${comp.shortName} (${comp.ticker}) — Primerjava trenutnih kazalnikov vrednotenj z 10-letno zgodovino podjetja (2016–2026)`;
    document.getElementById("histSelfTableTitle").textContent =
      `Statistična analiza večkratnikov družbe ${comp.name} (${comp.ticker}): Trenutno (2026) vs. Lastno 10-letno obdobje (2016–2025)`;

    const peZ = hv.pe ? hv.pe.zScore : 0;
    document.getElementById("histValBadgeWrap").innerHTML = `
      <span class="badge ${peZ <= 0.5 ? "badge-emerald" : peZ <= 1.8 ? "badge-amber" : "badge-rose"}">
        Z-Score P/E: ${peZ > 0 ? "+" : ""}${fmtNum(peZ, 2)}σ glede na 10L zgodovino
      </span>
    `;

    const metricsConfig = [
      { key: "pe", label: "P/E (Cena / Čisti dobiček)", suffix: "x", lowerIsCheaper: true },
      { key: "pb", label: "P/B (Cena / Knjigovodska vrednost)", suffix: "x", lowerIsCheaper: true },
      { key: "evEbitda", label: "EV/EBITDA (Vrednost podjetja / EBITDA)", suffix: "x", lowerIsCheaper: true },
      { key: "ps", label: "P/S (Tržna kapitalizacija / Prihodki)", suffix: "x", lowerIsCheaper: true },
      { key: "pFcf", label: "P/FCF (Tržna kap. / Prosti denarni tok)", suffix: "x", lowerIsCheaper: true },
      { key: "divYieldPct", label: "Dividendna donosnost (%)", suffix: " %", lowerIsCheaper: false },
      { key: "roePct", label: "Donosnost kapitala — ROE (%)", suffix: " %", lowerIsCheaper: false }
    ];

    const selfBody = document.getElementById("histSelfComparisonBody");
    selfBody.innerHTML = metricsConfig
      .map((m) => {
        const st = hv[m.key];
        if (!st || st.current === null) {
          return `
            <tr>
              <td class="label-cell">${m.label}</td>
              <td colspan="11" class="text-muted" style="text-align:left;">Kazalnik se v bančnem/zavarovalniškem sektorju ne uporablja (uporabite P/E, P/B, ROE in Dividendno donosnost).</td>
            </tr>
          `;
        }

        const isGoodDiff = m.lowerIsCheaper ? st.diffVsAvgPct <= 0 : st.diffVsAvgPct >= 0;
        const diffAvgBadge = `<span class="badge ${isGoodDiff ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(st.diffVsAvgPct, 1)}</span>`;
        const diffMedBadge = `<span class="badge ${isGoodDiff ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(st.diffVsMedianPct, 1)}</span>`;

        let statusText = "V okviru 10L povprečja";
        let statusClass = "badge-blue";
        if (m.lowerIsCheaper) {
          if (st.zScore > 1.5) {
            statusText = "Nad 10L povprečjem (+Premija)";
            statusClass = "badge-rose";
          } else if (st.zScore < -0.3) {
            statusText = "Pod 10L povprečjem (Zgodovinski diskont)";
            statusClass = "badge-emerald";
          }
        } else {
          if (st.zScore >= 0) {
            statusText = "Nadpovprečna donosnost (10L)";
            statusClass = "badge-emerald";
          } else {
            statusText = "Pod 10L povprečjem (zaradi rasti tečaja)";
            statusClass = "badge-amber";
          }
        }

        const pctPos = Math.max(2, Math.min(98, st.percentile || 50));

        return `
          <tr>
            <td class="label-cell"><strong>${m.label}</strong></td>
            <td><strong class="text-blue">${fmtNum(st.current, 2, m.suffix)}</strong></td>
            <td>${fmtNum(st.avg10y, 2, m.suffix)}</td>
            <td>${fmtNum(st.median10y, 2, m.suffix)}</td>
            <td>${diffAvgBadge}</td>
            <td>${diffMedBadge}</td>
            <td>${fmtNum(st.min10y, 2, m.suffix)} <span class="text-muted">(${st.minYear})</span></td>
            <td>${fmtNum(st.max10y, 2, m.suffix)} <span class="text-muted">(${st.maxYear})</span></td>
            <td>
              <div class="range-bar-wrap">
                <div class="range-track">
                  <div class="range-fill" style="width:100%;"></div>
                  <div class="range-marker" style="left:calc(${pctPos}% - 2px);"></div>
                </div>
              </div>
            </td>
            <td>${fmtNum(st.percentile, 0)}. perc.</td>
            <td><strong>${st.zScore > 0 ? "+" : ""}${fmtNum(st.zScore, 2)}σ</strong></td>
            <td><span class="badge ${statusClass}">${statusText}</span></td>
          </tr>
        `;
      })
      .join("");

    // Chart 5A: 10-Year Historical P/E & EV/EBITDA Trajectory + 10Y Average Line
    const peSeries = hv.pe ? hv.pe.series : [];
    const evSeries = hv.evEbitda ? hv.evEbitda.series : [];
    const labels11 = peSeries.map((s) => s.year === "2026" ? "2026 TTM" : s.year);

    const datasets5A = [
      {
        label: "Zgodovinski P/E družbe (" + comp.ticker + ")",
        data: peSeries.map((s) => s.value),
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56, 189, 248, 0.14)",
        borderWidth: 2.6,
        fill: true,
        tension: 0.25,
        pointRadius: 3.5
      },
      {
        label: "10-letno povprečje P/E (" + fmtNum(hv.pe ? hv.pe.avg10y : 0, 2) + "x)",
        data: labels11.map(() => (hv.pe ? hv.pe.avg10y : null)),
        borderColor: "#f59e0b",
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false
      }
    ];

    if (evSeries && evSeries.some((s) => s.value !== null)) {
      datasets5A.push({
        label: "Zgodovinski EV/EBITDA (" + comp.ticker + ")",
        data: evSeries.map((s) => s.value),
        borderColor: "#10b981",
        backgroundColor: "transparent",
        borderWidth: 2.2,
        tension: 0.25,
        pointRadius: 3
      });
    }

    renderChart("histPeEv10Y", "chartHistPeEv10Y", {
      type: "line",
      data: { labels: labels11, datasets: datasets5A },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: { ticks: { color: "#94a3b8", callback: (v) => v + "x" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });

    // Chart 5B: 10-Year Historical P/B & Dividend Yield (%)
    const pbSeries = hv.pb ? hv.pb.series : [];
    const dySeries = hv.divYieldPct ? hv.divYieldPct.series : [];

    renderChart("histPbDiv10Y", "chartHistPbDiv10Y", {
      type: "line",
      data: {
        labels: labels11,
        datasets: [
          {
            label: "Zgodovinski P/B (leva os)",
            data: pbSeries.map((s) => s.value),
            borderColor: "#6366f1",
            backgroundColor: "rgba(99, 102, 241, 0.14)",
            borderWidth: 2.5,
            yAxisID: "y",
            fill: true,
            tension: 0.25
          },
          {
            label: "10L Povprečje P/B (" + fmtNum(hv.pb ? hv.pb.avg10y : 0, 2) + "x)",
            data: labels11.map(() => (hv.pb ? hv.pb.avg10y : null)),
            borderColor: "#a855f7",
            borderDash: [5, 4],
            borderWidth: 1.8,
            yAxisID: "y",
            pointRadius: 0
          },
          {
            label: "Dividendna donosnost % (desna os)",
            data: dySeries.map((s) => s.value),
            borderColor: "#10b981",
            backgroundColor: "transparent",
            borderWidth: 2.4,
            yAxisID: "y1",
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: {
            position: "left",
            ticks: { color: "#818cf8", callback: (v) => v + "x" },
            grid: { color: "rgba(148,163,184,0.08)" }
          },
          y1: {
            position: "right",
            ticks: { color: "#10b981", callback: (v) => v + " %" },
            grid: { display: false }
          }
        }
      }
    });

    // Cross-Index 10-Year Historical Self-Valuation Summary Table
    const crossHistBody = document.getElementById("crossHistSummaryBody");
    crossHistBody.innerHTML = DATA.companies
      .map((c) => {
        const hvc = c.historicalValuation;
        const pe = hvc.pe || {};
        const pb = hvc.pb || {};
        const ev = hvc.evEbitda || {};
        const dy = hvc.divYieldPct || {};
        const isSel = c.ticker === selectedTicker ? "highlight-row" : "";

        return `
          <tr class="${isSel}" data-ticker="${c.ticker}" style="cursor:pointer;">
            <td class="label-cell"><strong class="mono text-blue">${c.ticker}</strong> · ${c.shortName}</td>
            <td><strong>${fmtNum(pe.current, 2)}x</strong></td>
            <td>${fmtNum(pe.avg10y, 2)}x</td>
            <td>${fmtNum(pe.median10y, 2)}x</td>
            <td><span class="badge ${pe.diffVsAvgPct <= 0 ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(pe.diffVsAvgPct, 1)}</span></td>
            <td>${pe.zScore > 0 ? "+" : ""}${fmtNum(pe.zScore, 2)}σ</td>
            <td><strong>${fmtNum(pb.current, 2)}x</strong></td>
            <td>${fmtNum(pb.avg10y, 2)}x</td>
            <td><span class="badge ${pb.diffVsAvgPct <= 0 ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(pb.diffVsAvgPct, 1)}</span></td>
            <td>${ev && ev.current ? fmtNum(ev.current, 2) + "x" : "—"}</td>
            <td>${ev && ev.avg10y ? fmtNum(ev.avg10y, 2) + "x" : "—"}</td>
            <td class="text-emerald"><strong>${fmtNum(dy.current, 2)} %</strong></td>
            <td>${fmtNum(dy.avg10y, 2)} %</td>
          </tr>
        `;
      })
      .join("");

    crossHistBody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => selectCompany(tr.getAttribute("data-ticker")));
    });
  }

  // =========================================================================
  // MODULE 1B: SUMMARY OF LATEST PUBLISHED RESULTS (H1 & 9M / Q3 2026)
  // =========================================================================
  function renderLatestPublishedResults() {
    const tbody = document.getElementById("latestResultsSummaryBody");
    const cardsGrid = document.getElementById("latestResultsCardsGrid");
    if (!tbody || !cardsGrid) return;

    // 1. Summary Table
    tbody.innerHTML = DATA.companies
      .map((c) => {
        const lr = c.latestResults;
        if (!lr) return "";
        const h1 = lr.h1_2026;
        const q3 = lr.q3_9m_2026;
        const isSel = c.ticker === selectedTicker ? "highlight-row" : "";
        const h1Badge = h1.revYoYPct >= 0 ? "badge-emerald" : "badge-amber";
        const q3Badge = q3.niYoYPct >= 0 ? "badge-emerald" : "badge-amber";

        return `
          <tr class="${isSel}" data-ticker="${c.ticker}" style="cursor:pointer;">
            <td class="label-cell"><strong class="mono text-blue">${c.ticker}</strong> · ${c.shortName}</td>
            <td>${fmtNum(h1.revenueM, 1)} M€</td>
            <td><span class="badge ${h1Badge}">${fmtSignedPct(h1.revYoYPct, 1)}</span></td>
            <td><strong>${fmtNum(h1.netIncomeM, 1)} M€</strong> <span class="text-muted">(${fmtSignedPct(h1.niYoYPct, 1)})</span></td>
            <td>${fmtNum(q3.revenueM, 1)} M€</td>
            <td><strong>${fmtNum(q3.netIncomeM, 1)} M€</strong></td>
            <td><span class="badge ${q3Badge}">${fmtSignedPct(q3.niYoYPct, 1)}</span></td>
            <td><a href="${lr.reportUrl}" target="_blank" rel="noopener" class="text-blue" style="text-decoration:none;font-weight:700;" onclick="event.stopPropagation();">PDF ↗</a></td>
          </tr>
        `;
      })
      .join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => selectCompany(tr.getAttribute("data-ticker")));
    });

    // 2. YoY Growth Chart (9M Revenue YoY % vs 9M Net Income YoY %)
    renderChart("latestResultsYoY", "chartLatestResultsYoY", {
      type: "bar",
      data: {
        labels: DATA.companies.map((c) => c.ticker),
        datasets: [
          {
            label: "Rast prihodkov 9M 2026 (% YoY)",
            data: DATA.companies.map((c) => (c.latestResults ? c.latestResults.q3_9m_2026.revYoYPct : 0)),
            backgroundColor: "rgba(56, 189, 248, 0.82)",
            borderRadius: 4
          },
          {
            label: "Rast čistega dobička 9M 2026 (% YoY)",
            data: DATA.companies.map((c) => (c.latestResults ? c.latestResults.q3_9m_2026.niYoYPct : 0)),
            backgroundColor: DATA.companies.map((c) =>
              c.latestResults && c.latestResults.q3_9m_2026.niYoYPct >= 0 ? "#10b981" : "#f59e0b"
            ),
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: "#cbd5e1", font: { weight: "700" } }, grid: { display: false } },
          y: {
            ticks: { color: "#94a3b8", callback: (v) => v + " %" },
            grid: { color: "rgba(148,163,184,0.08)" }
          }
        }
      }
    });

    // 3. 9 Detailed Executive Summary Cards
    cardsGrid.innerHTML = DATA.companies
      .map((c) => {
        const lr = c.latestResults;
        if (!lr) return "";
        const h1 = lr.h1_2026;
        const q3 = lr.q3_9m_2026;
        const isAct = c.ticker === selectedTicker ? "active" : "";
        const sentBadge = lr.sentiment === "emerald" ? "badge-emerald" : "badge-amber";

        return `
          <div class="result-card ${isAct}" data-ticker="${c.ticker}">
            <div>
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px;">
                <div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="mono" style="font-size:16px;font-weight:800;color:var(--accent-blue);">${c.ticker}</span>
                    <span style="font-size:14.5px;font-weight:700;color:var(--text-primary);">${c.shortName}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);">${lr.reportTitle} · Objava: ${lr.publishedDate}</div>
                </div>
                <span class="badge ${sentBadge}">${lr.sentimentLabel}</span>
              </div>

              <div class="result-metrics-strip" style="margin:10px 0;">
                <div class="result-metric-box">
                  <span class="result-metric-lbl">Prihodki H1 2026</span>
                  <span class="result-metric-val">${fmtNum(h1.revenueM, 1)} M€ <span class="${h1.revYoYPct >= 0 ? "text-emerald" : "text-amber"}" style="font-size:11.5px;">(${fmtSignedPct(h1.revYoYPct, 1)})</span></span>
                </div>
                <div class="result-metric-box">
                  <span class="result-metric-lbl">Čisti dobiček H1 2026</span>
                  <span class="result-metric-val">${fmtNum(h1.netIncomeM, 1)} M€ <span class="${h1.niYoYPct >= 0 ? "text-emerald" : "text-amber"}" style="font-size:11.5px;">(${fmtSignedPct(h1.niYoYPct, 1)})</span></span>
                </div>
                <div class="result-metric-box">
                  <span class="result-metric-lbl">Prihodki ${q3.period}</span>
                  <span class="result-metric-val">${fmtNum(q3.revenueM, 1)} M€ <span class="${q3.revYoYPct >= 0 ? "text-emerald" : "text-amber"}" style="font-size:11.5px;">(${fmtSignedPct(q3.revYoYPct, 1)})</span></span>
                </div>
                <div class="result-metric-box">
                  <span class="result-metric-lbl">Čisti dob. ${q3.period}</span>
                  <span class="result-metric-val">${fmtNum(q3.netIncomeM, 1)} M€ <span class="${q3.niYoYPct >= 0 ? "text-emerald" : "text-amber"}" style="font-size:11.5px;">(${fmtSignedPct(q3.niYoYPct, 1)})</span></span>
                </div>
              </div>

              <div style="font-size:11.5px;font-weight:700;color:var(--accent-blue);margin-bottom:6px;display:flex;justify-content:space-between;">
                <span>KLJUČNI POUDARKI OBJAVLJENEGA POROČILA</span>
                <span class="mono text-emerald">${q3.keyMetricLabel}: ${q3.keyMetricValue}</span>
              </div>
              <ul class="result-bullets">
                ${lr.bullets.map((b) => `<li>${b}</li>`).join("")}
              </ul>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">
              <div class="result-guidance-box">
                <strong style="color:var(--accent-blue);">Napoved vodstva (Guidance):</strong> ${lr.guidance}
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;padding-top:4px;border-top:1px solid var(--border-subtle);">
                <span class="text-muted">Tečaj: <strong class="mono text-primary">${fmtNum(c.current.price, 2)} €</strong> · P/E: <strong class="mono text-primary">${fmtNum(c.current.pe, 1)}x</strong></span>
                <a href="${lr.reportUrl}" target="_blank" rel="noopener" class="text-blue" style="text-decoration:none;font-weight:700;" onclick="event.stopPropagation();">Odpri uradno poročilo (PDF) ↗</a>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    cardsGrid.querySelectorAll(".result-card").forEach((card) => {
      card.addEventListener("click", () => selectCompany(card.getAttribute("data-ticker")));
    });
  }

  // =========================================================================
  // COMPANY SELECTION & VIEW ROUTING
  // =========================================================================
  function selectCompany(ticker) {
    if (!ticker) return;
    selectedTicker = ticker;
    const comp = getCompany(selectedTicker);

    renderHeaderAndSelectors();
    renderModule1Index();
    renderLatestPublishedResults();
    renderModule2Financials(comp);
    loadSimulatorDefaultsForCompany(comp, "base");
    renderModule4Peers(comp);
    renderModule5HistoricalValuation(comp);
  }

  function setView(viewId) {
    activeView = viewId;
    document.querySelectorAll("#navTabs .nav-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === viewId);
    });

    const sectionIds = ["sec-index", "sec-latest-results", "sec-financials", "sec-simulator", "sec-peers", "sec-historical-val"];
    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (viewId === "all" || viewId === id) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // =========================================================================
  // CSV EXPORT
  // =========================================================================
  function exportCurrentCompanyCsv() {
    const comp = getCompany(selectedTicker);
    const headers = [
      "Leto",
      "Prihodki_mio_EUR",
      "EBITDA_mio_EUR",
      "EBIT_mio_EUR",
      "Cisti_dobicek_mio_EUR",
      "FCF_mio_EUR",
      "Kapital_mio_EUR",
      "Cisti_dolg_mio_EUR",
      "Tecaj_EUR",
      "EPS_EUR",
      "DPS_EUR",
      "BVPS_EUR",
      "PE",
      "PB",
      "EV_EBITDA",
      "Div_donos_pct",
      "ROE_pct"
    ];

    const rows = comp.history.map((h) => [
      h.year,
      h.revenueM,
      h.ebitdaM,
      h.ebitM,
      h.netIncomeM,
      h.fcfM,
      h.equityM,
      h.netDebtM,
      h.closePrice,
      h.eps,
      h.dps,
      h.bvps,
      h.pe,
      h.pb,
      h.evEbitda,
      h.divYieldPct,
      h.roePct
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8,\uFEFF" +
      [headers.join(";"), ...rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : v)).join(";"))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `SBITOP_${comp.ticker}_10Y_Financni_Podatki.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // =========================================================================
  // EVENT LISTENERS INITIALIZATION
  // =========================================================================
  function bindEvents() {
    document.getElementById("companySelect").addEventListener("change", (e) => {
      selectCompany(e.target.value);
    });

    document.querySelectorAll("#navTabs .nav-tab").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-view")));
    });

    document.getElementById("btnExportCsv").addEventListener("click", exportCurrentCompanyCsv);

    // Simulator dual-bound inputs (slider + number box)
    const pairs = [
      ["numBaseCf", "rngBaseCf", "baseCashFlowM"],
      ["numGrowth1", "rngGrowth1", "growthStage1Pct"],
      ["numGrowth2", "rngGrowth2", "growthStage2Pct"],
      ["numWacc", "rngWacc", "waccPct"],
      ["numTermG", "rngTermG", "terminalGrowthPct"],
      ["numExitMult", "rngExitMult", "exitMultiple"],
      ["numMos", "rngMos", "mosPct"]
    ];

    pairs.forEach(([numId, rngId, key]) => {
      const numEl = document.getElementById(numId);
      const rngEl = document.getElementById(rngId);

      const updateVal = (val) => {
        simState[key] = parseFloat(val) || 0;
        numEl.value = simState[key];
        rngEl.value = simState[key];
        const comp = getCompany(selectedTicker);
        document.getElementById("hintBaseCfPerShare").textContent =
          `${fmtNum(simState.baseCashFlowM / simState.sharesM, 2)} € / delnico`;
        renderSimulatorOutputs(comp);
      };

      numEl.addEventListener("input", (e) => updateVal(e.target.value));
      rngEl.addEventListener("input", (e) => updateVal(e.target.value));
    });

    document.getElementById("numNetDebt").addEventListener("input", (e) => {
      simState.netDebtM = parseFloat(e.target.value) || 0;
      renderSimulatorOutputs(getCompany(selectedTicker));
    });

    document.getElementById("selTerminalMethod").addEventListener("change", (e) => {
      simState.terminalMethod = e.target.value;
      renderSimulatorOutputs(getCompany(selectedTicker));
    });

    document.getElementById("btnPresetBear").addEventListener("click", () =>
      loadSimulatorDefaultsForCompany(getCompany(selectedTicker), "bear")
    );
    document.getElementById("btnPresetBase").addEventListener("click", () =>
      loadSimulatorDefaultsForCompany(getCompany(selectedTicker), "base")
    );
    document.getElementById("btnPresetBull").addEventListener("click", () =>
      loadSimulatorDefaultsForCompany(getCompany(selectedTicker), "bull")
    );
    document.getElementById("btnResetSim").addEventListener("click", () =>
      loadSimulatorDefaultsForCompany(getCompany(selectedTicker), "base")
    );
  }

  // Boot Application
  bindEvents();
  selectCompany("KRKG");
})();
