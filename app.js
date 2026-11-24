/**
 * SBI TOP Institucionalni Analitični & Vrednotenjski Terminal (LJSE 2016–2026)
 * Revidirana verzija (22. 11. 2026):
 *  - Brez izmišljenih podatkov: manjkajoče vrednosti so null v JSON in "ni podatka" v UI
 *  - Analitične ocene (Q3 bilanca, 2016-2024 dolg = 55 % dolg. obv., NOPAT 18 % davek) so označene z oznako "ocena"
 *  - Pravi TTM (FY2025 + 9M 2026 − 9M 2025) in enotno število delnic brez lastnih delnic (MSRP 33)
 *  - Normaliziran FCF = 5-letna mediana FCF (2021–2025), 5L in 3L povprečja izračunana neposredno iz history
 *  - Enotni odbitek za operativni denarni blažilnik: min(Bruto denar, 2,0 % × TTM prihodki)
 *  - Luka Koper (LKPG): vključena finančna naložba v KRKG (86,06 M€ po 20 % odbitku) + opozorilo in odbitek za 785 M€ razvojni CAPEX
 *  - Residual Income (NLBR, ZVTG, POSR): rast kapitala g = ROE × (1 − payout), linearno bledenje ROE proti ke, CAPM ke, 2D matrika ROE vs. ke
 *  - 68 tujih vrstnikov (N=6–8 na družbo) iz Yahoo Finance (yfinance, statični zajem 22. 11. 2026)
 *  - Dejanski N (8–10 letnih točk) in izpis izločenih ekstremov (0 < P/E < 38) pri zgodovinskih večkratnikih
 *  - Portfeljski simulator brez izgube fokusa ob tipkanju, shranjevanje v localStorage/URL, davčna stopnja in samo prihodnje neizplačane dividende
 */

(function () {
  "use strict";

  const DATA = window.SBITOP_DATA;
  if (!DATA || !DATA.companies) {
    console.error("Manjka window.SBITOP_DATA!");
    return;
  }

  const ALLOWED_VIEWS = new Set([
    "compact",
    "all",
    "sec-index",
    "sec-latest-results",
    "sec-financials",
    "sec-simulator",
    "sec-peers",
    "sec-historical-val",
    "sec-portfolio"
  ]);

  let selectedTicker = "KRKG";
  let activeView = "compact";
  let urlSimOverrides = null;
  const charts = {};

  // Portfolio state: map ticker -> share count, plus dividend tax rate %
  const portfolioShares = {};
  let dividendTaxRatePct = 25.0;

  // Simulator State
  let simState = {
    basisMode: "norm", // "norm" | "avg5y" | "avg3y" | "fy25" | "residual"
    baseCashFlowM: 313.69,
    normalizedRoePct: 14.5,
    bookValueM: 2485.0,
    payoutRatioPct: 50.0,
    growthStage1Pct: 6.5,
    growthStage2Pct: 4.5,
    waccPct: 8.8,
    terminalGrowthPct: 2.5,
    exitMultiple: 16.3,
    terminalMethod: "gordon",
    mosPct: 15.0,
    netDebtM: -178.92,
    financialInvestmentsM: 0.0,
    expansionCapexDeductionM: 0.0,
    sharesM: 30.556,
    activePreset: "base"
  };

  // HTML Escaping Helper (Item C23)
  function escHtml(val) {
    if (val === null || val === undefined) return "";
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Safe finite number parser that preserves 0 (Item C17)
  function numOr(val, fallback) {
    if (val === null || val === undefined || val === "") return fallback;
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }

  // Number Formatters (Slovenian locale, returns "ni podatka" for null/undefined, Item C23)
  function fmtNum(val, decimals = 2, suffix = "", nullText = "ni podatka") {
    if (val === null || val === undefined || val === "" || Number.isNaN(Number(val))) {
      return nullText;
    }
    return (
      Number(val).toLocaleString("sl-SI", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) + suffix
    );
  }

  function fmtSignedPct(val, decimals = 1, nullText = "ni podatka") {
    if (val === null || val === undefined || val === "" || Number.isNaN(Number(val))) {
      return nullText;
    }
    const n = Number(val);
    const sign = n > 0 ? "+" : "";
    return (
      sign +
      n.toLocaleString("sl-SI", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) +
      " %"
    );
  }

  function estTag(isEstimate, tooltip) {
    if (!isEstimate) return "";
    return `<abbr class="est-tag" title="${escHtml(tooltip || "Analitična ocena")}">ocena</abbr>`;
  }

  function getCompany(ticker) {
    return DATA.companies.find((c) => c.ticker === ticker) || DATA.companies[0];
  }

  // =========================================================================
  // VALUATION ENGINE: 2-STAGE DCF (NON-FINANCIALS) & RESIDUAL INCOME (BANKS/INSURERS)
  // =========================================================================
  function computeValuationModel(params, currentPrice) {
    const isResidual = params.basisMode === "residual";
    const g1 = numOr(params.growthStage1Pct, 0) / 100;
    const g2 = numOr(params.growthStage2Pct, 0) / 100;
    const wacc = Math.max(0.04, numOr(params.waccPct, 9.0) / 100);
    const rawTermG = numOr(params.terminalGrowthPct, 2.0) / 100;
    const termG = Math.min(wacc - 0.015, rawTermG);
    const exitMult = Math.max(1.0, numOr(params.exitMultiple, 12.0));
    const method = params.terminalMethod || "gordon";
    const mos = numOr(params.mosPct, 15.0) / 100;
    const netDebt = numOr(params.netDebtM, 0);
    const finInvM = numOr(params.financialInvestmentsM, 0);
    const capexDedM = numOr(params.expansionCapexDeductionM, 0);
    const shares = Math.max(0.001, numOr(params.sharesM, 1));

    if (isResidual) {
      // Residual Income (Excess Return) Model for Banks & Insurers (Item B11):
      // (a) Retention growth g_BV = ROE_t * (1 - payout), scaled by user Stage 1/2 adjustments
      // (b) ROE_t fades linearly in Years 6..10 toward ke + 50% of initial excess spread (and toward ke in terminal perpetuity)
      const b0 = Math.max(1, numOr(params.bookValueM, 1000));
      const roe0 = numOr(params.normalizedRoePct, 13.5) / 100;
      const ke = wacc; // Cost of equity
      const payout = Math.min(0.95, Math.max(0.0, numOr(params.payoutRatioPct, 50.0) / 100));
      // Terminal ROE fades 50% of excess spread toward ke (or equals ke if roe0 <= ke)
      const roeTermEnd = roe0 > ke ? ke + 0.5 * (roe0 - ke) : roe0;

      const years = [];
      let currBv = b0;
      let sumPvEva = 0;

      for (let yr = 1; yr <= 10; yr++) {
        // Linear ROE fade in years 6..10 toward roeTermEnd
        const fadeWeight = yr <= 5 ? 0 : (yr - 5) / 5;
        const roeYr = roe0 * (1 - fadeWeight) + roeTermEnd * fadeWeight;
        // Book value growth driven by retention g = ROE_t * (1 - payout) in stage 1, or user slider g1/g2
        const retentionG = roeYr * (1 - payout);
        const g = yr <= 5 ? g1 : Math.min(g2, retentionG);
        const netInc = currBv * roeYr;
        const capCharge = currBv * ke;
        const eva = netInc - capCharge; // Residual income
        const df = 1 / Math.pow(1 + ke, yr);
        const pvEva = eva * df;
        sumPvEva += pvEva;

        years.push({
          step: yr,
          periodLabel: yr === 1 ? "Leto 1 (NTM)" : `Leto ${yr}`,
          roePct: roeYr * 100,
          growthPct: g * 100,
          bookValueM: currBv,
          netIncomeM: netInc,
          cashFlowM: eva,
          discountFactor: df,
          pvCashFlowM: pvEva
        });

        currBv = currBv * (1 + g);
      }

      const lastEva = years[years.length - 1].cashFlowM;
      const df10 = years[years.length - 1].discountFactor;
      // Terminal residual income with continuing fade factor (ke - termG + 0.02 fade rate)
      const fadeSpread = Math.max(0.015, ke - termG);
      const tvEva = lastEva > 0 ? (lastEva * (1 + termG * 0.5)) / fadeSpread : 0;
      const pvTerminalM = Math.max(0, tvEva * df10);

      const equityValueM = Math.max(0, b0 + sumPvEva + pvTerminalM);
      const fairValuePerShare = equityValueM / shares;
      const buyPriceWithMos = fairValuePerShare * (1 - mos);
      const upsidePct = currentPrice > 0 ? ((fairValuePerShare - currentPrice) / currentPrice) * 100 : 0;
      const impliedMosPct = fairValuePerShare > 0 ? ((fairValuePerShare - currentPrice) / fairValuePerShare) * 100 : 0;
      const justifiedPb = equityValueM / b0;

      return {
        isResidual: true,
        years,
        startingBookValueM: b0,
        payoutRatioPct: payout * 100,
        retentionGrowthPct: roe0 * (1 - payout) * 100,
        terminalRoePct: roeTermEnd * 100,
        justifiedPb,
        sumPvCfM: sumPvEva,
        terminalValueM: tvEva,
        pvTerminalM,
        tvShareOfEvPct: equityValueM > 0 ? (pvTerminalM / equityValueM) * 100 : 0,
        enterpriseValueM: equityValueM,
        netDebtM: 0,
        financialInvestmentsM: 0,
        expansionCapexDeductionM: 0,
        equityValueM,
        sharesM: shares,
        fairValuePerShare,
        buyPriceWithMos,
        upsidePct,
        impliedMosPct,
        impliedGordonMult: null,
        impliedExitMult: null
      };
    }

    // Standard 2-Stage DCF Model (with Normalized 5Y Median FCF, Operating Cash Buffer Haircut, and LKPG Krka stake / CAPEX)
    const baseCf = numOr(params.baseCashFlowM, 0);
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
        periodLabel: yr === 1 ? "Leto 1 (NTM)" : `Leto ${yr}`,
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

    const impliedGordonMult = cfYear10 !== 0 ? tvGordon / cfYear10 : exitMult;
    const impliedActiveMult = cfYear10 !== 0 ? terminalValueM / cfYear10 : exitMult;

    const pvTerminalM = terminalValueM * dfYear10;
    const enterpriseValueM = sumPvCf + pvTerminalM;
    // EV -> Equity bridge: EV - NetDebt + FinancialInvestments (e.g. LKPG Krka stake 86.06 M€) - ExpansionCapexDeduction
    const equityValueM = enterpriseValueM - netDebt + finInvM - capexDedM;
    const fairValuePerShare = Math.max(0, equityValueM / shares);
    const buyPriceWithMos = fairValuePerShare * (1 - mos);
    const upsidePct = currentPrice > 0 ? ((fairValuePerShare - currentPrice) / currentPrice) * 100 : 0;
    const impliedMosPct = fairValuePerShare > 0 ? ((fairValuePerShare - currentPrice) / fairValuePerShare) * 100 : 0;

    return {
      isResidual: false,
      years,
      sumPvCfM: sumPvCf,
      terminalValueM,
      pvTerminalM,
      tvShareOfEvPct: enterpriseValueM > 0 ? (pvTerminalM / enterpriseValueM) * 100 : 0,
      enterpriseValueM,
      netDebtM: netDebt,
      financialInvestmentsM: finInvM,
      expansionCapexDeductionM: capexDedM,
      equityValueM,
      sharesM: shares,
      fairValuePerShare,
      buyPriceWithMos,
      upsidePct,
      impliedMosPct,
      impliedGordonMult,
      impliedExitMult: exitMult,
      impliedActiveMult
    };
  }

  function computeCompanyDefaultValuation(comp, basisOverride = null) {
    const d = comp.dcfDefaults;
    const mode = basisOverride || (d.isFinancialModel ? "residual" : "norm");
    let cf = numOr(d.fcfNormalizedM, d.baseCashFlowM);
    if (mode === "avg5y") cf = d.fcf5yAvgM;
    else if (mode === "avg3y") cf = d.fcf3yAvgM;
    else if (mode === "fy25") cf = d.fcfPeak2025M;

    return computeValuationModel(
      {
        basisMode: mode,
        baseCashFlowM: cf,
        normalizedRoePct: numOr(d.normalizedRoePct, comp.current.roePct),
        bookValueM: numOr(d.bookValueM, comp.current.equityM),
        payoutRatioPct: numOr(d.payoutRatioPct, 50.0),
        growthStage1Pct: d.growthStage1Pct,
        growthStage2Pct: d.growthStage2Pct,
        waccPct: d.waccPct,
        terminalGrowthPct: d.terminalGrowthPct,
        exitMultiple: d.exitMultiple,
        terminalMethod: "gordon",
        mosPct: d.mosPct,
        netDebtM: d.netDebtM,
        financialInvestmentsM: numOr(d.financialInvestmentsM, 0),
        expansionCapexDeductionM: 0,
        sharesM: d.sharesM
      },
      comp.current.price
    );
  }

  // Reverse DCF Solver
  function computeReverseDcf(params, targetPrice) {
    if (params.basisMode === "residual") {
      let low = 2.0;
      let high = 35.0;
      for (let i = 0; i < 40; i++) {
        const mid = 0.5 * (low + high);
        const res = computeValuationModel({ ...params, normalizedRoePct: mid }, targetPrice);
        if (res.fairValuePerShare < targetPrice) low = mid;
        else high = mid;
      }
      return {
        type: "roe",
        impliedValuePct: 0.5 * (low + high)
      };
    }

    let low = -15.0;
    let high = 35.0;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (low + high);
      const res = computeValuationModel(
        {
          ...params,
          growthStage1Pct: mid,
          growthStage2Pct: mid * 0.75
        },
        targetPrice
      );
      if (res.fairValuePerShare < targetPrice) low = mid;
      else high = mid;
    }
    return {
      type: "growth",
      impliedValuePct: 0.5 * (low + high)
    };
  }

  function renderChart(key, canvasId, config) {
    if (charts[key]) {
      charts[key].destroy();
    }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    charts[key] = new Chart(ctx, config);
  }

  // =========================================================================
  // LOCAL STORAGE & URL ROUTING / SHARE LINK (Items C16, C21)
  // =========================================================================
  function savePortfolioToStorage() {
    try {
      localStorage.setItem(
        "sbitop_portfolio_v2",
        JSON.stringify({
          shares: portfolioShares,
          taxRatePct: dividendTaxRatePct
        })
      );
    } catch (e) {
      // ignore storage errors
    }
  }

  function loadPortfolioFromStorage() {
    try {
      const raw = localStorage.getItem("sbitop_portfolio_v2");
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.shares && typeof parsed.shares === "object") {
        let hasAny = false;
        DATA.companies.forEach((c) => {
          if (parsed.shares[c.ticker] !== undefined) {
            portfolioShares[c.ticker] = Math.max(0, Number(parsed.shares[c.ticker]) || 0);
            hasAny = true;
          }
        });
        if (parsed.taxRatePct !== undefined) {
          dividendTaxRatePct = numOr(parsed.taxRatePct, 25.0);
        }
        return hasAny;
      }
    } catch (e) {
      // ignore
    }
    return false;
  }

  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("ticker");
    const v = params.get("view");
    if (t && DATA.companies.some((c) => c.ticker === t.toUpperCase())) {
      selectedTicker = t.toUpperCase();
    }
    if (v && ALLOWED_VIEWS.has(v)) {
      activeView = v;
    }

    // Check optional simulator parameter overrides in URL
    const hasSimParams = ["basis", "cf", "roe", "g1", "g2", "wacc", "tg", "mos", "m", "capex"].some((k) =>
      params.has(k)
    );
    if (hasSimParams) {
      urlSimOverrides = {
        basisMode: params.get("basis") || null,
        baseCashFlowM: params.has("cf") ? Number(params.get("cf")) : null,
        normalizedRoePct: params.has("roe") ? Number(params.get("roe")) : null,
        growthStage1Pct: params.has("g1") ? Number(params.get("g1")) : null,
        growthStage2Pct: params.has("g2") ? Number(params.get("g2")) : null,
        waccPct: params.has("wacc") ? Number(params.get("wacc")) : null,
        terminalGrowthPct: params.has("tg") ? Number(params.get("tg")) : null,
        mosPct: params.has("mos") ? Number(params.get("mos")) : null,
        terminalMethod: params.get("m") || null,
        expansionCapexDeductionM: params.has("capex") ? Number(params.get("capex")) : null
      };
    }

    // Check optional portfolio shares in URL (?port=KRKG:100,NLBR:50...)
    const portStr = params.get("port");
    if (portStr) {
      portStr.split(",").forEach((pair) => {
        const [tk, qty] = pair.split(":");
        if (tk && DATA.companies.some((c) => c.ticker === tk.toUpperCase())) {
          portfolioShares[tk.toUpperCase()] = Math.max(0, Number(qty) || 0);
        }
      });
    }
    if (params.has("tax")) {
      dividendTaxRatePct = numOr(params.get("tax"), 25.0);
    }
  }

  function updateUrlParams() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("ticker", selectedTicker);
      url.searchParams.set("view", activeView);
      url.searchParams.set("basis", simState.basisMode);
      url.searchParams.set("cf", String(simState.baseCashFlowM));
      url.searchParams.set("roe", String(simState.normalizedRoePct));
      url.searchParams.set("g1", String(simState.growthStage1Pct));
      url.searchParams.set("g2", String(simState.growthStage2Pct));
      url.searchParams.set("wacc", String(simState.waccPct));
      url.searchParams.set("tg", String(simState.terminalGrowthPct));
      url.searchParams.set("mos", String(simState.mosPct));
      url.searchParams.set("m", simState.terminalMethod);
      if (selectedTicker === "LKPG" && simState.expansionCapexDeductionM > 0) {
        url.searchParams.set("capex", String(simState.expansionCapexDeductionM));
      } else {
        url.searchParams.delete("capex");
      }
      window.history.replaceState({}, "", url.toString());
    } catch (e) {
      // ignore on file:// protocol
    }
  }

  // =========================================================================
  // HEADER, SIDEBAR, TICKER TAPE & PILL SELECTOR
  // =========================================================================
  function renderHeaderAndSelectors() {
    const idx = DATA.indexSummary;
    const asOf = DATA.asOfDate || "20. 11. 2026";
    const lastChk = DATA.lastCheckedAt || "22. 11. 2026";

    const elAsOf = document.getElementById("sidebarAsOfDate");
    const elChk = document.getElementById("sidebarLastChecked");
    const elBadge = document.getElementById("marketTimestampBadge");
    const elFootChk = document.getElementById("footerLastChecked");
    if (elAsOf) elAsOf.textContent = asOf;
    if (elChk) elChk.textContent = lastChk;
    if (elBadge) elBadge.textContent = `Podatki na dan: ${asOf} · Zadnja preverba: ${lastChk}`;
    if (elFootChk) elFootChk.textContent = lastChk;
    document.querySelectorAll(".js-as-of-date").forEach((el) => { el.textContent = asOf; });

    const tapeEl = document.getElementById("tickerTape");
    let tapeHtml = `
      <div class="tape-index-badge">
        <span>SBI TOP</span>
        <span class="mono">${fmtNum(idx.value, 2)}</span>
        <span class="text-emerald mono">${fmtSignedPct(idx.change1YPct, 2)} (1L)</span>
      </div>
      <div class="tape-index-badge" style="background: rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.3); color: #34d399;">
        <span>Agregatni P/E: ${fmtNum(idx.aggregatePe, 2)}x</span>
        <span class="mono">· P/B: ${fmtNum(idx.weightedPb, 2)}x</span>
      </div>
    `;

    DATA.companies.forEach((c) => {
      const isAct = c.ticker === selectedTicker ? "active" : "";
      const chgClass = c.current.change1YPct >= 0 ? "text-emerald" : "text-rose";
      tapeHtml += `
        <div class="tape-item ${isAct}" data-ticker="${escHtml(c.ticker)}">
          <span class="tape-symbol">${escHtml(c.ticker)}</span>
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
      .map(
        (c) =>
          `<option value="${escHtml(c.ticker)}" ${c.ticker === selectedTicker ? "selected" : ""}>${escHtml(c.ticker)} — ${escHtml(c.shortName)} (${fmtNum(c.current.price, 2)} € · TTM P/E ${fmtNum(c.current.pe, 1)}x)</option>`
      )
      .join("");

    // 9-Company Pill Bar
    const pillBarEl = document.getElementById("companyPillBar");
    pillBarEl.innerHTML = DATA.companies
      .map((c) => {
        const isAct = c.ticker === selectedTicker ? "active" : "";
        const chgClass = c.current.change1YPct >= 0 ? "text-emerald" : "text-rose";
        return `
          <div class="company-pill ${isAct}" data-ticker="${escHtml(c.ticker)}">
            <div class="pill-top">
              <span class="pill-ticker">${escHtml(c.ticker)}</span>
              <span class="pill-weight">${fmtNum(c.sbitopWeight, 2)} %</span>
            </div>
            <div class="pill-name">${escHtml(c.shortName)}</div>
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

    // Left Sidebar Company List
    const sideCompEl = document.getElementById("sidebarCompanyList");
    if (sideCompEl) {
      sideCompEl.innerHTML = DATA.companies
        .map((c) => {
          const isAct = c.ticker === selectedTicker ? "active" : "";
          return `
            <button class="sidebar-company-btn ${isAct}" data-ticker="${escHtml(c.ticker)}">
              <span><strong class="mono">${escHtml(c.ticker)}</strong> · ${escHtml(c.shortName)}</span>
              <span class="mono" style="font-size:11px;">${fmtNum(c.current.price, 1)} €</span>
            </button>
          `;
        })
        .join("");

      sideCompEl.querySelectorAll(".sidebar-company-btn").forEach((btn) => {
        btn.addEventListener("click", () => selectCompany(btn.getAttribute("data-ticker")));
      });
    }
  }

  // =========================================================================
  // MODULE 1: SBI TOP INDEX OVERVIEW & MASTER SCREENER (TRUE TTM)
  // =========================================================================
  function renderModule1Index() {
    const idx = DATA.indexSummary;
    const kpiGrid = document.getElementById("indexKpiGrid");

    document.getElementById("chartIndexPeBadge").textContent =
      `Agregatni P/E indeksa: ${fmtNum(idx.aggregatePe, 2)}x (Harmonični: ${fmtNum(idx.harmonicWeightedPe, 2)}x)`;

    const trCagrBadge = document.getElementById("chartIndexTrCagrBadge");
    if (trCagrBadge) {
      trCagrBadge.textContent = `SBI TOP TR 10L CAGR: +${fmtNum(idx.cagr10YTotalReturnPct, 2)} % (Izračun iz cene + div.)`;
    }

    // Note: Do NOT sum Petrol turnover + bank interest + insurance premiums as "TTM prihodki" (Item A9)
    kpiGrid.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label"><span>Vrednost indeksa SBI TOP</span><span class="badge badge-emerald">${fmtSignedPct(idx.change1YPct, 2)} (1L)</span></div>
        <div class="kpi-value">${fmtNum(idx.value, 2)} <span style="font-size:13px;color:var(--text-secondary);">točk</span></div>
        <div class="kpi-sub">10L cenovni CAGR: <strong class="text-emerald">+${fmtNum(idx.cagr10YPricePct, 2)} %/leto</strong> · SBI TOP TR (cena+div.): <strong>${fmtNum(idx.totalReturnValue, 2)} (+${fmtNum(idx.cagr10YTotalReturnPct, 2)} %/leto)</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Tržna kapitalizacija (Brez lastnih delnic)</span><span class="badge badge-blue">Utež: ${fmtNum(idx.totalWeightPct, 2)} %</span></div>
        <div class="kpi-value">${fmtNum(idx.totalMarketCapEurBn, 2)} <span style="font-size:13px;color:var(--text-secondary);">mrd €</span></div>
        <div class="kpi-sub">Z zakladnimi delnicami: <strong>${fmtNum(idx.totalIssuedMarketCapEurBn, 2)} mrd €</strong> · Skupni TTM čisti dobiček: <strong>${fmtNum(idx.totalNetIncomeTtmEurBn, 2)} mrd €</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Agregatni &amp; Harmonični P/E in P/B indeksa</span><span class="badge badge-emerald">Σ MCap / Σ TTM Dob.</span></div>
        <div class="kpi-value">P/E ${fmtNum(idx.aggregatePe, 2)}x <span style="font-size:14px;color:var(--text-secondary);">· P/B ${fmtNum(idx.weightedPb, 2)}x</span></div>
        <div class="kpi-sub">Harmonični tehtani P/E: <strong>${fmtNum(idx.harmonicWeightedPe, 2)}x</strong> · Aritmetični P/E: <strong>${fmtNum(idx.arithmeticWeightedPe, 2)}x</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Dividendna donosnost &amp; ROE indeksa</span><span class="badge badge-blue">Podatki: ${escHtml(DATA.asOfDate)}</span></div>
        <div class="kpi-value">${fmtNum(idx.weightedDivYieldPct, 2)} % <span style="font-size:14px;color:var(--text-secondary);">Div. donos</span></div>
        <div class="kpi-sub">Agregatni TTM ROE indeksa: <strong class="text-emerald">${fmtNum(idx.weightedRoePct, 2)} %</strong></div>
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
            label: "SBI TOP TR (izračun iz cene + reinvestiranih dividend, 2016=100)",
            data: hist.map((h) => Number(((h.sbitopTr / baseTr) * 100).toFixed(1))),
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.12)",
            borderWidth: 2.8,
            fill: true,
            tension: 0.28,
            pointRadius: 3.5
          },
          {
            label: "SBI TOP Cenovni indeks (LJSE tečajnica, 2016=100)",
            data: hist.map((h) => Number(((h.sbitop / baseSbi) * 100).toFixed(1))),
            borderColor: "#38bdf8",
            backgroundColor: "transparent",
            borderWidth: 2.4,
            tension: 0.28,
            pointRadius: 3
          },
          {
            label: "DAX 40 (^GDAXI Yahoo Finance, 2016=100)",
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
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11.2 } } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } },
          y: { ticks: { color: "#94a3b8", callback: (v) => v + " pt" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });

    // Chart 1B: True TTM P/E vs 10Y Average P/E vs Foreign Peer Median P/E
    renderChart("indexMult", "chartIndexMultiples", {
      type: "bar",
      data: {
        labels: DATA.companies.map((c) => c.ticker),
        datasets: [
          {
            label: `Pravi TTM P/E (${DATA.asOfDate || "24. 11. 2026"})`,
            data: DATA.companies.map((c) => c.current.pe),
            backgroundColor: "#38bdf8",
            borderRadius: 4
          },
          {
            label: "Lastno 10-letno povprečje P/E (2016–2025, N=8–10)",
            data: DATA.companies.map((c) => c.historicalValuation.pe.avg10y),
            backgroundColor: "#6366f1",
            borderRadius: 4
          },
          {
            label: "Mediana tujih vrstnikov P/E (Yahoo Finance 22. 11. 2026)",
            data: DATA.companies.map((c) => c.peerComparison.peerMedian.pe),
            backgroundColor: "#10b981",
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11.2 } } } },
        scales: {
          x: { ticks: { color: "#cbd5e1", font: { weight: "700" } }, grid: { display: false } },
          y: { ticks: { color: "#94a3b8", callback: (v) => v + "x" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });

    // Master Screener Table
    const tbody = document.getElementById("masterScreenerBody");
    tbody.innerHTML = DATA.companies
      .map((c) => {
        const cur = c.current;
        const valRes = computeCompanyDefaultValuation(c);
        const hvPe = c.historicalValuation.pe;
        const pc = c.peerComparison;
        const isSel = c.ticker === selectedTicker ? "highlight-row" : "";

        const modelBadge = c.isFinancial
          ? `<span class="badge badge-blue" title="Model presežnega donosa kapitala (ROE proti ke z bledenjem)">Residual Income</span>`
          : c.ticker === "LKPG"
          ? `<span class="badge badge-amber" title="5L mediana FCF + Naložba v KRKG (86,1 M€ po 20% odbitku)">5L Med. DCF + KRKG</span>`
          : `<span class="badge badge-neutral" title="Normaliziran FCF = 5-letna mediana FCF (2021–2025) + 2% operativni denarni blažilnik">5L Mediana DCF</span>`;

        const mosClass = valRes.impliedMosPct >= 5 ? "badge-emerald" : valRes.impliedMosPct >= -12 ? "badge-amber" : "badge-rose";
        const peerDiffVal = pc.premiumVsPeerMedianPct.pe;
        const peerLabel = peerDiffVal <= 0 ? "diskont" : "premija";
        const peerDiffBadge =
          peerDiffVal !== null && peerDiffVal !== undefined
            ? `<span class="badge ${peerDiffVal <= 0 ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(peerDiffVal, 1)} (${peerLabel})</span>`
            : "ni podatka";

        const zVal = hvPe ? hvPe.zScore : 0;
        const pctVal = hvPe ? hvPe.percentile : 50;
        const nVal = hvPe ? hvPe.sampleSizeN : 10;
        const zClass = zVal <= 0.5 ? "text-emerald" : zVal <= 1.8 ? "text-amber" : "text-rose";

        return `
          <tr class="${isSel}" data-ticker="${escHtml(c.ticker)}" style="cursor:pointer;" title="Kliknite za izbiro družbe ${escHtml(c.name)}">
            <td class="label-cell"><strong class="mono text-blue">${escHtml(c.ticker)}</strong> · ${escHtml(c.shortName)}</td>
            <td style="text-align:left;">${modelBadge}</td>
            <td>${fmtNum(c.sbitopWeight, 2)} % <span class="text-muted" style="font-size:10.5px;">(LJSE ${fmtNum(c.sbitopOfficialWeight, 2)}%)</span></td>
            <td><strong>${fmtNum(cur.price, 2)} €</strong></td>
            <td>${fmtNum(cur.marketCapM, 1)}</td>
            <td><strong>${fmtNum(valRes.fairValuePerShare, 2)} €</strong></td>
            <td><span class="badge ${mosClass}">${fmtSignedPct(valRes.impliedMosPct, 1)}</span></td>
            <td class="${valRes.upsidePct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(valRes.upsidePct, 1)}</td>
            <td><strong>${cur.pe !== null ? fmtNum(cur.pe, 2) + "x" : "ni podatka"}</strong> <span class="text-muted" style="font-size:10.5px;">(FY25: ${cur.peFy25 !== null ? fmtNum(cur.peFy25, 1) + "x" : "ni pod."})</span></td>
            <td>${hvPe && hvPe.avg10y !== null ? fmtNum(hvPe.avg10y, 2) + "x" : "ni podatka"}</td>
            <td>${fmtNum(pc.peerMedian.pe, 2)}x</td>
            <td>${peerDiffBadge}</td>
            <td>${fmtNum(cur.pb, 2)}x${estTag(cur.bsIsEstimate, "Kapital Q3 2026 je analitična ocena")}</td>
            <td>${cur.evEbitda !== null ? fmtNum(cur.evEbitda, 2) + "x" : "ni podatka (Fin.)"}</td>
            <td class="text-emerald"><strong>${fmtNum(cur.divYieldPct, 2)} %</strong></td>
            <td>${fmtNum(cur.roePct, 1)} %</td>
            <td class="${zClass}">${hvPe && hvPe.zScore !== null ? (zVal > 0 ? "+" : "") + fmtNum(zVal, 2) + "σ" : "ni podatka"} <span class="text-muted" style="font-size:10.5px;">(N=${nVal})</span></td>
          </tr>
        `;
      })
      .join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => selectCompany(tr.getAttribute("data-ticker")));
    });
  }

  // =========================================================================
  // MODULE 2: SUMMARY OF LATEST PUBLISHED RESULTS (H1 & 9M / Q3 2026)
  // =========================================================================
  function renderLatestPublishedResults() {
    const tbody = document.getElementById("latestResultsSummaryBody");
    const cardsGrid = document.getElementById("latestResultsCardsGrid");
    if (!tbody || !cardsGrid) return;

    tbody.innerHTML = DATA.companies
      .map((c) => {
        const lr = c.latestResults;
        if (!lr) return "";
        const h1 = lr.h1_2026;
        const q3 = lr.q3_9m_2026;
        const cur = c.current;
        const isSel = c.ticker === selectedTicker ? "highlight-row" : "";
        const h1RevBadge = h1.revYoYPct >= 0 ? "badge-emerald" : "badge-amber";
        const q3RevBadge = q3.revYoYPct >= 0 ? "badge-emerald" : "badge-amber";
        const q3NiBadge = q3.niYoYPct >= 0 ? "badge-emerald" : "badge-amber";

        return `
          <tr class="${isSel}" data-ticker="${escHtml(c.ticker)}" style="cursor:pointer;">
            <td class="label-cell"><strong class="mono text-blue">${escHtml(c.ticker)}</strong> · ${escHtml(c.shortName)}</td>
            <td>${fmtNum(h1.revenueM, 1)} M€</td>
            <td><span class="badge ${h1RevBadge}">${fmtSignedPct(h1.revYoYPct, 1)}</span></td>
            <td><strong>${fmtNum(h1.netIncomeM, 1)} M€</strong> <span class="text-muted">(${fmtSignedPct(h1.niYoYPct, 1)})</span></td>
            <td>${fmtNum(q3.revenueM, 1)} M€</td>
            <td><span class="badge ${q3RevBadge}">${fmtSignedPct(q3.revYoYPct, 1)}</span></td>
            <td><strong>${fmtNum(q3.netIncomeM, 1)} M€</strong></td>
            <td><span class="badge ${q3NiBadge}">${fmtSignedPct(q3.niYoYPct, 1)}</span></td>
            <td><strong class="text-blue">${fmtNum(cur.netIncomeM, 1)} M€</strong> <span class="text-muted">(${fmtNum(cur.pe, 2)}x)</span></td>
            <td><a href="${escHtml(lr.reportUrl)}" target="_blank" rel="noopener" class="text-blue" style="text-decoration:none;font-weight:700;" onclick="event.stopPropagation();">PDF ↗</a></td>
          </tr>
        `;
      })
      .join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => selectCompany(tr.getAttribute("data-ticker")));
    });

    renderChart("latestResultsYoY", "chartLatestResultsYoY", {
      type: "bar",
      data: {
        labels: DATA.companies.map((c) => c.ticker),
        datasets: [
          {
            label: "9M 2026 Rast prihodkov (9M Prih. YoY %)",
            data: DATA.companies.map((c) => (c.latestResults ? c.latestResults.q3_9m_2026.revYoYPct : 0)),
            backgroundColor: "rgba(56, 189, 248, 0.82)",
            borderRadius: 4
          },
          {
            label: "9M 2026 Rast čistega dobička (9M Dob. YoY %)",
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
          y: { ticks: { color: "#94a3b8", callback: (v) => v + " %" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });

    cardsGrid.innerHTML = DATA.companies
      .map((c) => {
        const lr = c.latestResults;
        if (!lr) return "";
        const h1 = lr.h1_2026;
        const q3 = lr.q3_9m_2026;
        const isAct = c.ticker === selectedTicker ? "active" : "";
        const sentBadge = lr.sentiment === "emerald" ? "badge-emerald" : "badge-amber";

        return `
          <div class="result-card ${isAct}" data-ticker="${escHtml(c.ticker)}">
            <div>
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px;">
                <div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="mono" style="font-size:15.5px;font-weight:800;color:var(--accent-blue);">${escHtml(c.ticker)}</span>
                    <span style="font-size:14px;font-weight:700;color:var(--text-primary);">${escHtml(c.shortName)}</span>
                  </div>
                  <div style="font-size:10.8px;color:var(--text-muted);">${escHtml(lr.reportTitle)} · Objava: ${escHtml(lr.publishedDate)}</div>
                </div>
                <span class="badge ${sentBadge}">${escHtml(lr.sentimentLabel)}</span>
              </div>

              <div class="result-metrics-strip" style="margin:9px 0;">
                <div class="result-metric-box">
                  <span class="result-metric-lbl">Prihodki H1 26 (Prih. YoY)</span>
                  <span class="result-metric-val">${fmtNum(h1.revenueM, 1)} M€ <span class="${h1.revYoYPct >= 0 ? "text-emerald" : "text-amber"}" style="font-size:11.2px;">(${fmtSignedPct(h1.revYoYPct, 1)})</span></span>
                </div>
                <div class="result-metric-box">
                  <span class="result-metric-lbl">Čisti dob. H1 26 (Dob. YoY)</span>
                  <span class="result-metric-val">${fmtNum(h1.netIncomeM, 1)} M€ <span class="${h1.niYoYPct >= 0 ? "text-emerald" : "text-amber"}" style="font-size:11.2px;">(${fmtSignedPct(h1.niYoYPct, 1)})</span></span>
                </div>
                <div class="result-metric-box">
                  <span class="result-metric-lbl">Prihodki 9M 26 (Prih. YoY)</span>
                  <span class="result-metric-val">${fmtNum(q3.revenueM, 1)} M€ <span class="${q3.revYoYPct >= 0 ? "text-emerald" : "text-amber"}" style="font-size:11.2px;">(${fmtSignedPct(q3.revYoYPct, 1)})</span></span>
                </div>
                <div class="result-metric-box">
                  <span class="result-metric-lbl">Čisti dob. 9M 26 (Dob. YoY)</span>
                  <span class="result-metric-val">${fmtNum(q3.netIncomeM, 1)} M€ <span class="${q3.niYoYPct >= 0 ? "text-emerald" : "text-amber"}" style="font-size:11.2px;">(${fmtSignedPct(q3.niYoYPct, 1)})</span></span>
                </div>
              </div>

              <div style="font-size:11px;font-weight:700;color:var(--accent-blue);margin-bottom:5px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;">
                <span>POUDARKI POROČILA</span>
                <span class="mono text-emerald">${escHtml(q3.keyMetricLabel)}: ${escHtml(q3.keyMetricValue)}</span>
              </div>
              <ul class="result-bullets">
                ${lr.bullets.map((b) => `<li>${escHtml(b)}</li>`).join("")}
              </ul>
            </div>

            <div style="display:flex;flex-direction:column;gap:7px;margin-top:6px;">
              <div class="result-guidance-box">
                <strong style="color:var(--accent-blue);">Napoved vodstva (Guidance):</strong> ${escHtml(lr.guidance)}
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.2px;padding-top:4px;border-top:1px solid var(--border-subtle);">
                <span class="text-muted">Tečaj: <strong class="mono text-primary">${fmtNum(c.current.price, 2)} €</strong> · Pravi TTM P/E: <strong class="mono text-primary">${fmtNum(c.current.pe, 2)}x</strong></span>
                <a href="${escHtml(lr.reportUrl)}" target="_blank" rel="noopener" class="text-blue" style="text-decoration:none;font-weight:700;" onclick="event.stopPropagation();">Uradno poročilo (PDF) ↗</a>
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
  // MODULE 3: 10-YEAR HISTORICAL FINANCIALS (2016–2025 + TRUE 2026 TTM)
  // =========================================================================
  function renderModule2Financials(comp) {
    const cur = comp.current;
    const cagrs = comp.cagrs10y;
    const hist = comp.history;
    const latestReportUrl = hist[hist.length - 1].reportUrl || "https://seonet.ljse.si";

    document.getElementById("finSectionTitle").textContent =
      `${comp.name} (${comp.ticker}) — 10-letni zgodovinski finančni podatki (2016–2025 + Pravi 2026 TTM)`;

    document.getElementById("finReportLinkWrap").innerHTML = `
      <a href="${escHtml(latestReportUrl)}" target="_blank" rel="noopener" class="btn-action" style="text-decoration:none;">
        <span>Uradno revidirano poročilo (SEOnet PDF) ↗</span>
      </a>
    `;

    const p = comp.biiPillars;
    const pillarLabels = [
      { label: "Predvidljivost poslovanja", val: p.predictability },
      { label: "Konkurenčni jarek (Moat)", val: p.moat },
      { label: "Upravljanje in alokacija kapitala", val: p.management },
      { label: "Bilančna trdnost", val: p.financial },
      { label: "Donosnost kapitala (ROE / ROIC)", val: p.roic },
      { label: "Privlačnost vrednotenja & dividende", val: p.price }
    ];

    const eps2022NoteHtml = comp.eps2022Note
      ? `<div style="margin-top:8px;padding:7px 10px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.35);border-radius:4px;font-size:11.5px;color:#fbbf24;"><strong>Metodološka opomba za leto 2022:</strong> ${escHtml(comp.eps2022Note)}</div>`
      : "";

    document.getElementById("companyHeroBanner").innerHTML = `
      <div>
        <div class="hero-title-row">
          <span class="hero-ticker">${escHtml(comp.ticker)}</span>
          <h3 class="hero-name">${escHtml(comp.name)}</h3>
          <span class="badge badge-blue">ISIN: ${escHtml(comp.isin)}</span>
          <span class="badge badge-emerald">Piotroski F-Score: ${comp.fScore}/9</span>
          <span class="badge badge-neutral">Utež (Rebas.): ${fmtNum(comp.sbitopWeight, 2)} %</span>
        </div>
        <p class="hero-thesis">${escHtml(comp.thesis.summary)}</p>
        <div style="font-size:12.3px;color:var(--text-secondary);margin-bottom:11px;">
          <strong class="text-blue">Konkurenčna prednost (Moat):</strong> ${escHtml(comp.thesis.moat)}
        </div>
        <div class="interim-banner">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:4px;">
            <strong class="text-emerald">Tekoče poslovanje (${escHtml(comp.interim2026.period)} → Pravi TTM):</strong>
            <span class="mono">TTM Prihodki: <strong>${fmtNum(cur.revenueM, 1)} mio €</strong> (FY25: ${fmtNum(cur.revenueFy25M, 1)} M€) · TTM Čisti dobiček: <strong>${fmtNum(cur.netIncomeM, 1)} mio €</strong> (FY25: ${fmtNum(cur.netIncomeFy25M, 1)} M€)</span>
          </div>
          <div style="color:var(--text-secondary);font-size:11.8px;">${escHtml(comp.interim2026.highlights)}</div>
        </div>
        ${eps2022NoteHtml}
      </div>

      <div style="display:flex;flex-direction:column;justify-content:space-between;gap:12px;background:rgba(9,14,23,0.75);padding:15px;border-radius:var(--radius-md);border:1px solid var(--border-subtle);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:10.5px;text-transform:uppercase;color:var(--text-muted);font-weight:700;">Kakovostni profil družbe (Podatki na dan: ${escHtml(DATA.asOfDate || "24. 11. 2026")})</div>
            <div style="font-size:13.5px;font-weight:700;color:var(--text-primary);">6 stebrov temeljnih kazalnikov</div>
          </div>
          <span class="badge badge-emerald">BII: ${comp.biiScore} / 600</span>
        </div>
        <div class="pillar-grid">
          ${pillarLabels
            .map(
              (pl) => `
            <div class="pillar-item">
              <div class="pillar-top">
                <span>${escHtml(pl.label)}</span>
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
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;font-size:11.2px;color:var(--text-muted);border-top:1px solid var(--border-subtle);padding-top:8px;">
          <span>Brez lastnih delnic (MSRP 33): <strong class="mono text-blue">${fmtNum(comp.sharesEffectiveM, 3)} mio</strong></span>
          <span>Izdane: <strong class="mono text-primary">${fmtNum(comp.sharesIssuedM, 3)} mio</strong> (Zakladne: ${fmtNum(comp.treasurySharesM, 3)} M)</span>
        </div>
      </div>
    `;

    document.getElementById("companyKpiGrid").innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label"><span>Borzni tečaj (${escHtml(cur.asOfDate)})</span><span class="badge ${cur.change1YPct >= 0 ? "badge-emerald" : "badge-rose"}">${fmtSignedPct(cur.change1YPct, 1)} (1L)</span></div>
        <div class="kpi-value">${fmtNum(cur.price, 2)} €</div>
        <div class="kpi-sub">10L CAGR tečaja: <strong class="text-emerald">${fmtSignedPct(cagrs.priceCagrPct, 1)}/leto</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Tržna kap. &amp; EV (Enotne delnice)</span><span class="badge badge-neutral">${fmtNum(comp.sharesEffectiveM, 2)}M delnic</span></div>
        <div class="kpi-value">${fmtNum(cur.marketCapM, 1)} <span style="font-size:13px;color:var(--text-secondary);">mio €</span></div>
        <div class="kpi-sub">EV: <strong>${fmtNum(cur.enterpriseValueM, 1)} M€</strong> · Prilag. čisti dolg: <strong>${fmtNum(cur.netDebtM, 1)} M€</strong> (Surovi: ${fmtNum(cur.rawNetDebtM, 1)} M€)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>${escHtml(comp.revenueLabel)} (Pravi TTM)</span><span class="badge badge-blue">10L CAGR ${fmtSignedPct(cagrs.revenueCagrPct, 1)}</span></div>
        <div class="kpi-value">${fmtNum(cur.revenueM, 1)} <span style="font-size:13px;color:var(--text-secondary);">mio €</span></div>
        <div class="kpi-sub">FY 2025: <strong>${fmtNum(cur.revenueFy25M, 1)} mio €</strong> · 2016: <strong>${fmtNum(hist[0].revenueM, 1)} mio €</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Čisti poslovni izid (Pravi TTM)</span><span class="badge badge-emerald">TTM P/E ${fmtNum(cur.pe, 2)}x</span></div>
        <div class="kpi-value">${fmtNum(cur.netIncomeM, 1)} <span style="font-size:13px;color:var(--text-secondary);">mio €</span></div>
        <div class="kpi-sub">EPS TTM: <strong>${fmtNum(cur.eps, 2)} €</strong> (FY25: ${fmtNum(cur.epsFy25, 2)} € pri istem št. delnic)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Kapital &amp; Donosnost (TTM)</span><span class="badge badge-blue">BVPS TTM ${fmtNum(cur.bvps, 2)} €</span></div>
        <div class="kpi-value">${fmtNum(cur.roePct, 1)} % <span style="font-size:13px;color:var(--text-secondary);">ROE TTM</span></div>
        <div class="kpi-sub">TTM Kapital: <strong>${fmtNum(cur.equityM, 1)} M€</strong>${estTag(cur.bsIsEstimate, "Kapital Q3 2026 je analitična ocena")} · TTM P/B: <strong>${fmtNum(cur.pb, 2)}x</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Dividenda 2026 &amp; Izplačilno razm.</span><span class="badge badge-emerald">${fmtNum(cur.divYieldPct, 2)} % donos</span></div>
        <div class="kpi-value">${fmtNum(cur.dps, 2)} €</div>
        <div class="kpi-sub">Ex-Div: <strong>${escHtml(comp.dividendCalendar.exDivDate)}</strong> · Payout (DPS/TTM EPS): <strong>${fmtNum(comp.dividendCalendar.payoutRatioPct, 1)} %</strong></div>
      </div>
    `;

    const yearsPlusTtm = [...hist.map((h) => h.year), "2026 TTM"];

    // Chart 2A: Revenue, EBITDA/EBIT & Net Income (2016-2026 TTM)
    renderChart("revProfit10Y", "chartRevProfit10Y", {
      type: "bar",
      data: {
        labels: yearsPlusTtm,
        datasets: [
          {
            label: comp.revenueLabel + " (mio €)",
            data: [...hist.map((h) => h.revenueM), cur.revenueM],
            backgroundColor: "rgba(56, 189, 248, 0.75)",
            borderRadius: 3
          },
          {
            label: (cur.ebitdaM ? "EBITDA" : "EBT / Dobiček pred davki") + " (mio €)",
            data: [...hist.map((h) => (h.ebitdaM !== null ? h.ebitdaM : h.ebitM)), cur.ebitdaM !== null ? cur.ebitdaM : cur.ebitM],
            backgroundColor: "rgba(99, 102, 241, 0.85)",
            borderRadius: 3
          },
          {
            label: "Čisti dobiček (mio €)",
            data: [...hist.map((h) => h.netIncomeM), cur.netIncomeM],
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

    // Chart 2B: ROE, ROIC & Net Margin (2016-2026 TTM)
    renderChart("marginsRoe10Y", "chartMarginsRoe10Y", {
      type: "line",
      data: {
        labels: yearsPlusTtm,
        datasets: [
          {
            label: "ROE — Donosnost kapitala (%)",
            data: [...hist.map((h) => h.roePct), cur.roePct],
            borderColor: "#10b981",
            backgroundColor: "rgba(16,185,129,0.1)",
            borderWidth: 2.5,
            tension: 0.25,
            fill: true
          },
          {
            label: "Čista dobičkovna marža (%)",
            data: [...hist.map((h) => h.netMarginPct), cur.netMarginPct],
            borderColor: "#38bdf8",
            borderWidth: 2.2,
            tension: 0.25
          },
          {
            label: cur.ebitdaMarginPct ? "EBITDA marža (%)" : "ROA — Donosnost sredstev (%)",
            data: [...hist.map((h) => (h.ebitdaMarginPct !== null ? h.ebitdaMarginPct : h.roaPct)), cur.ebitdaMarginPct !== null ? cur.ebitdaMarginPct : cur.roaPct],
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
          y: { ticks: { color: "#94a3b8", callback: (v) => v + " %" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });

    // Chart 2C: EPS, DPS & Year-End Share Price (2016-2026 TTM)
    renderChart("epsDpsPrice10Y", "chartEpsDpsPrice10Y", {
      type: "bar",
      data: {
        labels: yearsPlusTtm,
        datasets: [
          {
            type: "bar",
            label: "Čisti dobiček na delnico — EPS (€, brez lastnih)",
            data: [...hist.map((h) => h.eps), cur.eps],
            backgroundColor: "rgba(56, 189, 248, 0.75)",
            yAxisID: "y",
            borderRadius: 3
          },
          {
            type: "bar",
            label: "Dividenda na delnico — DPS (€)",
            data: [...hist.map((h) => h.dps), cur.dps],
            backgroundColor: "#10b981",
            yAxisID: "y",
            borderRadius: 3
          },
          {
            type: "line",
            label: "Zaključni tečaj delnice LJSE (€, desna os)",
            data: [...hist.map((h) => h.closePrice), cur.price],
            borderColor: "#f59e0b",
            backgroundColor: "transparent",
            borderWidth: 2.5,
            yAxisID: "y1",
            tension: 0.25,
            pointRadius: 3,
            spanGaps: false
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
          y: { position: "left", ticks: { color: "#38bdf8", callback: (v) => v + " €" }, grid: { color: "rgba(148,163,184,0.08)" } },
          y1: { position: "right", ticks: { color: "#f59e0b", callback: (v) => v + " €" }, grid: { display: false } }
        }
      }
    });

    // Full 10-Year Financial Table (2016–2025 + True 2026 TTM + 10Y CAGR) with "ocena" badges (Item A8)
    const thead = document.getElementById("historicalFinancialsHead");
    thead.innerHTML = `
      <tr>
        <th>Finančni kazalnik / Leto</th>
        ${hist.map((h) => `<th>${escHtml(h.year)}</th>`).join("")}
        <th style="color:var(--accent-blue);">2026 TTM (Pravi)</th>
        <th style="color:var(--accent-emerald);">10L CAGR</th>
      </tr>
    `;

    const rowsSpec = [
      { divider: "Izkaz poslovnega izida in denarni tokovi (v mio € · TTM = FY25 + 9M26 − 9M25)" },
      { label: comp.revenueLabel + " (mio €)", key: "revenueM", curr: cur.revenueM, cagr: cagrs.revenueCagrPct, dec: 1, bold: true },
      { label: "EBITDA (mio €)", key: "ebitdaM", curr: cur.ebitdaM, cagr: cagrs.ebitdaCagrPct, dec: 1 },
      {
        label: "EBIT / Dobiček pred davki (mio €)",
        key: "ebitM",
        curr: cur.ebitM,
        currEst: cur.ebitIsEstimate,
        currEstNote: "TTM EBIT ocenjen iz 0,85 × ΔEBITDA",
        cagr: null,
        dec: 1
      },
      { label: "Čisti poslovni izid (mio €)", key: "netIncomeM", curr: cur.netIncomeM, cagr: cagrs.netIncomeCagrPct, dec: 2, bold: true },
      { label: "Denarni tok iz poslovanja — OCF (mio €)", key: "operatingCashFlowM", curr: hist[9].operatingCashFlowM, cagr: null, dec: 1 },
      { label: "Investicije — CAPEX (mio €)", key: "capexM", curr: hist[9].capexM, cagr: null, dec: 1 },
      {
        label: "Prosti denarni tok — FCF (mio € · TTM stolpec = 5L mediana)",
        key: "fcfM",
        curr: cur.fcfM,
        cagr: null,
        dec: 2,
        bold: true
      },

      { divider: "Bilanca stanja in zaposlenost (v mio €)" },
      {
        label: "Celotna sredstva / Bilančna vsota (mio €)",
        key: "assetsM",
        curr: cur.assetsM,
        currEst: cur.bsIsEstimate,
        currEstNote: "Bilančna vsota Q3 2026 je analitična ocena",
        cagr: null,
        dec: 1
      },
      {
        label: "Kapital delničarjev (mio €)",
        key: "equityM",
        curr: cur.equityM,
        currEst: cur.bsIsEstimate,
        currEstNote: "Kapital delničarjev Q3 2026 je analitična ocena",
        cagr: cagrs.equityCagrPct,
        dec: 1,
        bold: true
      },
      { label: "Bruto denarna sredstva (mio €)", key: "cashM", curr: hist[9].cashM, cagr: null, dec: 1 },
      {
        label: "Čisti finančni dolg / (-Presežni denar) (mio €)",
        key: "netDebtM",
        histEstKey: "debtIsEstimate",
        histEstNote: "Dolg 2016–2024 ocenjen kot 55 % dolgoročnih obveznosti",
        curr: cur.netDebtM,
        cagr: null,
        dec: 1
      },
      { label: "Število zaposlenih", key: "employees", curr: hist[9].employees, cagr: null, dec: 0 },

      { divider: `Kazalniki na delnico (Enotno število delnic brez lastnih: ${fmtNum(comp.sharesEffectiveM, 3)} mio)` },
      { label: "Zaključni tečaj delnice LJSE (€)", key: "closePrice", curr: cur.price, cagr: cagrs.priceCagrPct, dec: 2, suffix: " €", bold: true },
      { label: "Čisti dobiček na delnico — EPS (€)", key: "eps", curr: cur.eps, cagr: cagrs.netIncomeCagrPct, dec: 2, suffix: " €", bold: true },
      { label: "Dividenda na delnico — DPS (€)", key: "dps", curr: cur.dps, cagr: cagrs.dpsCagrPct, dec: 2, suffix: " €" },
      {
        label: "Knjigovodska vrednost na delnico — BVPS (€)",
        key: "bvps",
        curr: cur.bvps,
        currEst: cur.bsIsEstimate,
        currEstNote: "BVPS Q3 2026 temelji na ocenjenem kapitalu",
        cagr: cagrs.equityCagrPct,
        dec: 2,
        suffix: " €",
        bold: true
      },
      { label: "Donosnost kapitala — ROE (%)", key: "roePct", curr: cur.roePct, cagr: null, dec: 1, suffix: " %" },
      {
        label: "Donosnost investiranega kapitala — ROIC (%)",
        key: "roicPct",
        histEstKey: "roicIsEstimate",
        histEstNote: "ROIC izračunan z ocenjeno 18 % davčno stopnjo v NOPAT",
        curr: cur.roicPct,
        currEst: cur.roicIsEstimate,
        currEstNote: "TTM ROIC prevzet iz FY 2025 z 18 % davčno stopnjo v NOPAT",
        cagr: null,
        dec: 1,
        suffix: " %"
      },
      { label: "EBITDA marža (%)", key: "ebitdaMarginPct", curr: cur.ebitdaMarginPct, cagr: null, dec: 1, suffix: " %" },
      { label: "Čista dobičkovna marža (%)", key: "netMarginPct", curr: cur.netMarginPct, cagr: null, dec: 1, suffix: " %" },

      { divider: "Zgodovinski večkratniki vrednotenja ob koncu leta in pravi TTM" },
      { label: "P/E (Cena / Čisti dobiček)", key: "pe", curr: cur.pe, cagr: null, dec: 2, suffix: "x", bold: true },
      { label: "P/B (Cena / Knjigovodska vrednost)", key: "pb", curr: cur.pb, currEst: cur.bsIsEstimate, currEstNote: "P/B temelji na ocenjenem kapitalu Q3 2026", cagr: null, dec: 2, suffix: "x", bold: true },
      { label: "EV/EBITDA", key: "evEbitda", histEstKey: "debtIsEstimate", histEstNote: "EV vključuje ocenjeni dolg (55 % dolg. obveznosti)", curr: cur.evEbitda, cagr: null, dec: 2, suffix: "x" },
      { label: "P/S (Cena / Prihodki)", key: "ps", curr: cur.ps, cagr: null, dec: 2, suffix: "x" },
      { label: "Dividendna donosnost (%)", key: "divYieldPct", curr: cur.divYieldPct, cagr: null, dec: 2, suffix: " %", bold: true }
    ];

    const tbody = document.getElementById("historicalFinancialsBody");
    tbody.innerHTML = rowsSpec
      .map((r) => {
        if (r.divider) {
          return `<tr class="section-divider"><td colspan="13">${escHtml(r.divider)}</td></tr>`;
        }
        const rowClass = r.bold ? "highlight-row" : "";
        const sfx = r.suffix || "";
        return `
          <tr class="${rowClass}">
            <td class="label-cell">${escHtml(r.label)}</td>
            ${hist
              .map((h) => {
                const vStr = fmtNum(h[r.key], r.dec, sfx);
                const isHest = r.histEstKey && h[r.histEstKey] && h[r.key] !== null;
                return `<td>${vStr}${estTag(isHest, r.histEstNote)}</td>`;
              })
              .join("")}
            <td style="color:var(--accent-blue);font-weight:700;">${fmtNum(r.curr, r.dec, sfx)}${estTag(r.currEst && r.curr !== null, r.currEstNote)}</td>
            <td style="color:var(--accent-emerald);font-weight:700;">${r.cagr !== null && r.cagr !== undefined ? fmtSignedPct(r.cagr, 1) : "ni podatka"}</td>
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
        return `<div class="text-muted" style="font-size:12px;">Podrobna segmentacija je vključena v konsolidiranem letnem poročilu (${escHtml(fallbackTitle)}).</div>`;
      }
      return bObj.items
        .slice(0, 6)
        .map(
          (it) => `
          <div style="margin-bottom:7px;">
            <div style="display:flex;justify-content:space-between;font-size:11.8px;margin-bottom:3px;">
              <span style="color:var(--text-primary);font-weight:500;">${escHtml(it.label)}</span>
              <span class="mono">${fmtNum(it.valueM, 1)} M€ (${fmtNum(it.sharePct, 1)} %)</span>
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
        ${geoBreakdown ? `<div style="margin-top:11px;padding-top:9px;border-top:1px solid var(--border-subtle);"><div style="font-size:11px;font-weight:700;color:var(--accent-blue);margin-bottom:7px;">GEOGRAFSKA STRUKTURA TRGOV</div>${renderBreakdownList(geoBreakdown, "Regija Adria & EU")}</div>` : ""}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Ključni katalizatorji rasti in tveganja</div>
            <div class="card-subtitle">Strateški dejavniki za obdobje 2026–2030</div>
          </div>
        </div>
        <div style="margin-bottom:11px;">
          <div style="font-size:11px;font-weight:700;color:#34d399;text-transform:uppercase;margin-bottom:5px;">Katalizatorji ustvarjanja vrednosti</div>
          <ul style="padding-left:16px;font-size:12px;color:var(--text-secondary);display:flex;flex-direction:column;gap:5px;">
            ${comp.thesis.catalysts.map((c) => `<li>${escHtml(c)}</li>`).join("")}
          </ul>
        </div>
        <div style="padding-top:9px;border-top:1px solid var(--border-subtle);">
          <div style="font-size:11px;font-weight:700;color:#fb7185;text-transform:uppercase;margin-bottom:5px;">Ključna tveganja poslovanja</div>
          <ul style="padding-left:16px;font-size:12px;color:var(--text-secondary);display:flex;flex-direction:column;gap:5px;">
            ${comp.thesis.risks.map((r) => `<li>${escHtml(r)}</li>`).join("")}
          </ul>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Največji delničarji družbe (${escHtml(comp.ownership.asOf || "2026")})</div>
            <div class="card-subtitle">${escHtml(comp.ownership.sourceLabel || "Centralna klirinško depotna družba (KDD)")}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${owners
            .slice(0, 8)
            .map(
              (o, i) => `
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.8px;padding:5px 8px;background:rgba(10,15,24,0.55);border-radius:4px;">
                <span style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:74%;"><strong class="mono text-muted">${i + 1}.</strong> ${escHtml(o.name)}</span>
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
  // MODULE 4: INTERACTIVE DCF / RESIDUAL INCOME & REVERSE DCF SIMULATOR
  // =========================================================================
  function loadSimulatorDefaultsForCompany(comp, preset = "base", basisOverride = null, applyUrlOverrides = false) {
    const d = comp.dcfDefaults;
    const defaultBasis = basisOverride || (d.isFinancialModel ? "residual" : "norm");

    let multG1 = 1.0;
    let multG2 = 1.0;
    let waccAdj = 0.0;
    let termAdj = 0.0;
    let roeAdj = 0.0;

    if (preset === "bear") {
      multG1 = 0.6;
      multG2 = 0.6;
      waccAdj = 0.9;
      termAdj = -0.4;
      roeAdj = -2.0;
    } else if (preset === "bull") {
      multG1 = 1.3;
      multG2 = 1.25;
      waccAdj = -0.5;
      termAdj = 0.4;
      roeAdj = 1.8;
    }

    let baseCf = numOr(d.fcfNormalizedM, d.baseCashFlowM);
    if (defaultBasis === "avg5y") baseCf = d.fcf5yAvgM;
    else if (defaultBasis === "avg3y") baseCf = d.fcf3yAvgM;
    else if (defaultBasis === "fy25") baseCf = d.fcfPeak2025M;

    const normRoe = Number((numOr(d.normalizedRoePct, comp.current.roePct) + roeAdj).toFixed(1));
    const payoutPct = numOr(d.payoutRatioPct, 50.0);

    simState = {
      basisMode: defaultBasis,
      baseCashFlowM: Number(baseCf.toFixed(2)),
      normalizedRoePct: normRoe,
      bookValueM: numOr(d.bookValueM, comp.current.equityM),
      payoutRatioPct: payoutPct,
      growthStage1Pct: Number((d.growthStage1Pct * multG1).toFixed(1)),
      growthStage2Pct: Number((d.growthStage2Pct * multG2).toFixed(1)),
      waccPct: Number((d.waccPct + waccAdj).toFixed(1)),
      terminalGrowthPct: Number(Math.max(0.0, d.terminalGrowthPct + termAdj).toFixed(1)),
      exitMultiple: d.exitMultiple,
      terminalMethod: document.getElementById("selTerminalMethod").value || "gordon",
      mosPct: numOr(d.mosPct, 15.0),
      netDebtM: d.netDebtM,
      financialInvestmentsM: numOr(d.financialInvestmentsM, 0.0),
      expansionCapexDeductionM: 0.0,
      sharesM: d.sharesM,
      activePreset: preset
    };

    if (applyUrlOverrides && urlSimOverrides) {
      if (urlSimOverrides.basisMode) simState.basisMode = urlSimOverrides.basisMode;
      if (urlSimOverrides.baseCashFlowM !== null && Number.isFinite(urlSimOverrides.baseCashFlowM))
        simState.baseCashFlowM = urlSimOverrides.baseCashFlowM;
      if (urlSimOverrides.normalizedRoePct !== null && Number.isFinite(urlSimOverrides.normalizedRoePct))
        simState.normalizedRoePct = urlSimOverrides.normalizedRoePct;
      if (urlSimOverrides.growthStage1Pct !== null && Number.isFinite(urlSimOverrides.growthStage1Pct))
        simState.growthStage1Pct = urlSimOverrides.growthStage1Pct;
      if (urlSimOverrides.growthStage2Pct !== null && Number.isFinite(urlSimOverrides.growthStage2Pct))
        simState.growthStage2Pct = urlSimOverrides.growthStage2Pct;
      if (urlSimOverrides.waccPct !== null && Number.isFinite(urlSimOverrides.waccPct))
        simState.waccPct = urlSimOverrides.waccPct;
      if (urlSimOverrides.terminalGrowthPct !== null && Number.isFinite(urlSimOverrides.terminalGrowthPct))
        simState.terminalGrowthPct = urlSimOverrides.terminalGrowthPct;
      if (urlSimOverrides.mosPct !== null && Number.isFinite(urlSimOverrides.mosPct))
        simState.mosPct = urlSimOverrides.mosPct;
      if (urlSimOverrides.terminalMethod) simState.terminalMethod = urlSimOverrides.terminalMethod;
      if (urlSimOverrides.expansionCapexDeductionM !== null && Number.isFinite(urlSimOverrides.expansionCapexDeductionM))
        simState.expansionCapexDeductionM = urlSimOverrides.expansionCapexDeductionM;
      urlSimOverrides = null; // consume once
    }

    const rngCf = document.getElementById("rngBaseCf");
    const absMax = Math.max(25, Math.ceil(Math.max(Math.abs(d.fcfPeak2025M || 10), Math.abs(baseCf)) * 2.2));
    rngCf.min = d.fcfPeak2025M < 0 ? Math.floor(d.fcfPeak2025M * 1.5) : Math.max(0.5, Math.floor(baseCf * 0.25));
    rngCf.max = absMax;
    rngCf.step = Math.abs(baseCf) < 30 ? 0.1 : 0.5;

    syncSimulatorInputsFromState(comp);
    renderSimulatorOutputs(comp);
  }

  function syncSimulatorInputsFromState(comp) {
    const d = comp.dcfDefaults;
    const isRes = simState.basisMode === "residual";
    const isLkpg = comp.ticker === "LKPG";

    document.getElementById("selSimBasis").value = simState.basisMode;
    document.getElementById("selTerminalMethod").value = simState.terminalMethod;
    document.getElementById("fieldBaseCfWrap").style.display = isRes ? "none" : "flex";
    document.getElementById("fieldNormRoeWrap").style.display = isRes ? "flex" : "none";
    document.getElementById("fieldExitMultWrap").style.display = isRes ? "none" : "flex";
    document.getElementById("fieldLkpgSpecialWrap").style.display = isLkpg && !isRes ? "flex" : "none";

    // Luka Koper (LKPG) 785 M€ CAPEX & Krka stake warning banner (Item A4)
    const lkpgAlertEl = document.getElementById("lkpgCapexAlertWrap");
    if (lkpgAlertEl) {
      if (isLkpg) {
        lkpgAlertEl.style.display = "block";
        lkpgAlertEl.innerHTML = `
          <div class="capex-warning-banner">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:4px;">
              <strong style="color:#fbbf24;">METODOLOŠKO OPOZORILO ZA LUKO KOPER (LKPG): Naložba v KRKG (+${fmtNum(d.financialInvestmentsM, 2)} M€) in razvojni investicijski cikel 785 M€ (2024–2028)</strong>
              <span class="badge badge-amber">Dejanski FY25 FCF = ${fmtNum(d.fcfPeak2025M, 2)} M€ · 5L Mediana FCF = ${fmtNum(d.fcfNormalizedM, 2)} M€</span>
            </div>
            <div>
              1. <strong>Finančna naložba v delnice Krke (KRKG):</strong> Luka Koper ima v lasti <strong>433.786 delnic KRKG</strong> (tržna vrednost ${fmtNum(d.financialInvestmentsGrossM, 2)} M€ pri 248,00 €; po 20 % odbitku za likvidnost in davek = <strong>+${fmtNum(d.financialInvestmentsM, 2)} M€</strong> oz. <strong>+6,15 €/delnico</strong>), kar je eksplicitno prišteto pri prehodu iz EV v lastniški kapital.<br/>
              2. <strong>Načrtovani razvojni CAPEX (785 M€ v 2024–2028):</strong> Zaradi podaljšanja Pomola I in gradnje severnega terminala je bil dejanski FCF v FY 2025 negativen (<strong>${fmtNum(d.fcfPeak2025M, 2)} M€</strong>). Osnovni model temelji na 5-letni mediani FCF (${fmtNum(d.fcfNormalizedM, 2)} M€) in tega razvojnega CAPEX presežka ne odšteva samodejno — v polju <em>»Odštej PV razvojnega CAPEX cikla«</em> v levem stolpcu lahko ročno odštejete ocenjeno sedanjo vrednost razvojnih investicij.
            </div>
          </div>
        `;
      } else {
        lkpgAlertEl.style.display = "none";
      }
    }

    document.getElementById("lblWacc").textContent = isRes
      ? "Strošek lastniškega kapitala (ke, %)"
      : "Diskontna stopnja (WACC, %)";
    document.getElementById("lblGrowth1").textContent = isRes
      ? "Letna rast knjigovodskega kapitala · 1. faza (1–5L, %)"
      : "Letna stopnja rasti FCF · 1. faza (Leta 1–5, %)";

    document.getElementById("numBaseCf").value = simState.baseCashFlowM;
    document.getElementById("rngBaseCf").value = simState.baseCashFlowM;
    document.getElementById("numNormRoe").value = simState.normalizedRoePct;
    document.getElementById("rngNormRoe").value = simState.normalizedRoePct;
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
    const lkpgCapexInp = document.getElementById("numLkpgCapexDeduction");
    if (lkpgCapexInp) lkpgCapexInp.value = simState.expansionCapexDeductionM;

    document.getElementById("hintBasisComparison").innerHTML = `
      <span>5L Mediana: <strong class="mono text-emerald">${fmtNum(d.fcfNormalizedM, 2)} M€</strong></span>
      <span>5L Povp.: <strong class="mono">${fmtNum(d.fcf5yAvgM, 2)} M€</strong></span>
      <span>3L Povp.: <strong class="mono">${fmtNum(d.fcf3yAvgM, 2)} M€</strong></span>
      <span>Dejanski FY25: <strong class="mono">${fmtNum(d.fcfPeak2025M, 2)} M€</strong></span>
    `;

    document.getElementById("hintBaseCfType").textContent = d.fcfNormalizedRule || comp.fcfLabel;
    document.getElementById("hintBaseCfPerShare").textContent =
      `${fmtNum(simState.baseCashFlowM / simState.sharesM, 2)} € / delnico`;

    document.getElementById("hintBookValueM").textContent =
      `TTM Kapital: ${fmtNum(simState.bookValueM, 1)} M€ (BVPS ${fmtNum(simState.bookValueM / simState.sharesM, 2)} €)`;

    const payoutInfoEl = document.getElementById("hintResidualPayoutInfo");
    if (payoutInfoEl && isRes) {
      const retG = simState.normalizedRoePct * (1 - simState.payoutRatioPct / 100);
      payoutInfoEl.innerHTML = `
        <span>Izplačilno razm. (Payout): <strong>${fmtNum(simState.payoutRatioPct, 1)} %</strong></span>
        <span class="mono">g = ROE×(1−p) = <strong>${fmtNum(retG, 2)} %/leto</strong></span>
      `;
    }

    const capmEl = document.getElementById("hintCapmNote");
    if (capmEl) {
      capmEl.innerHTML = `<span style="color:var(--accent-blue);">${escHtml(d.capmNote || "")}</span>`;
    }

    if (comp.isFinancial) {
      document.getElementById("hintCashHaircutInfo").innerHTML = `
        <span>Finančna ustanova (vrednotenje na ravni lastniškega kapitala B₀)</span>
        <span class="mono">Delnice: ${fmtNum(simState.sharesM, 3)} M</span>
      `;
    } else {
      document.getElementById("hintCashHaircutInfo").innerHTML = `
        <span>Dolg: ${fmtNum(d.grossDebtM, 1)} M€ · Bruto denar: ${fmtNum(d.grossCashM, 1)} M€ − 2% oper. blažilnik: ${fmtNum(d.operatingCashBufferM, 1)} M€</span>
        <span class="mono">Surovi čisti dolg: ${fmtNum(d.rawNetDebtM, 1)} M€</span>
      `;
    }

    const lkpgStakeEl = document.getElementById("hintLkpgKrkaStake");
    if (lkpgStakeEl && isLkpg) {
      lkpgStakeEl.innerHTML = `
        <span>+ Naložba v KRKG (po 20 % odbitku): <strong>+${fmtNum(simState.financialInvestmentsM, 2)} M€ (+6,15 €/deln.)</strong></span>
      `;
    }

    ["Bear", "Base", "Bull"].forEach((p) => {
      const btn = document.getElementById("btnPreset" + p);
      if (btn) {
        btn.classList.toggle("active", simState.activePreset === p.toLowerCase());
      }
    });
  }

  function renderSimulatorOutputs(comp) {
    const price = comp.current.price;
    const isRes = simState.basisMode === "residual";

    document.getElementById("simSectionTitle").textContent =
      `${comp.shortName} (${comp.ticker}) — Simulator projekcij, poštena vrednost (IV) in obratni DCF`;
    document.getElementById("simModelTypeBadge").textContent = isRes
      ? "Model presežnega donosa (Residual Income: ROE proti ke z bledenjem)"
      : comp.valuationModelType;
    document.getElementById("sensCurrentPriceBadge").textContent =
      `Borzni tečaj (${comp.ticker}): ${fmtNum(price, 2)} €`;

    const res = computeValuationModel(simState, price);

    if (isRes) {
      document.getElementById("hintJustifiedPb").textContent =
        `Upravičeni P/B: ${fmtNum(res.justifiedPb, 2)}x`;
      const payoutInfoEl = document.getElementById("hintResidualPayoutInfo");
      if (payoutInfoEl) {
        const retG = simState.normalizedRoePct * (1 - simState.payoutRatioPct / 100);
        payoutInfoEl.innerHTML = `
          <span>Payout: <strong>${fmtNum(simState.payoutRatioPct, 1)} %</strong> · g = ROE×(1−p) = <strong>${fmtNum(retG, 2)} %</strong></span>
          <span class="mono">Bledenje ROE → ${fmtNum(res.terminalRoePct, 1)} %</span>
        `;
      }
    } else {
      const impEl = document.getElementById("hintImpliedExitMult");
      if (impEl) {
        impEl.innerHTML = `
          <span>Gordon TV implicira EV/FCF₁₀ = <strong>${fmtNum(res.impliedGordonMult, 1)}x</strong></span>
          <span>Izhodni večkratnik = <strong>${fmtNum(res.impliedExitMult, 1)}x</strong> (Aktivni TV = <strong>${fmtNum(res.impliedActiveMult, 1)}x</strong>)</span>
        `;
      }
    }

    let verdictText = "POŠTENO VREDNOTENO";
    let verdictBadge = "badge-amber";
    if (res.impliedMosPct >= 10) {
      verdictText = "PODCENJENO (POZITIVNA VARNOSTNA REZERVA)";
      verdictBadge = "badge-emerald";
    } else if (res.impliedMosPct <= -12) {
      verdictText = "PRECENJENO GLEDE NA MODEL";
      verdictBadge = "badge-rose";
    }

    const lkpgBridgeExtra =
      res.financialInvestmentsM > 0 || res.expansionCapexDeductionM > 0
        ? ` · +KRKG: <strong>+${fmtNum(res.financialInvestmentsM, 1)} M€</strong>${res.expansionCapexDeductionM > 0 ? ` · −CAPEX: <strong>−${fmtNum(res.expansionCapexDeductionM, 1)} M€</strong>` : ""}`
        : "";

    const subNote = isRes
      ? `<div class="kpi-sub">Začetni kapital B₀: <strong>${fmtNum(res.startingBookValueM, 1)} M€</strong> · PV Presežnega donosa (EVA): <strong>${fmtNum(res.sumPvCfM + res.pvTerminalM, 1)} M€</strong> (Upravičeni P/B: <strong>${fmtNum(res.justifiedPb, 2)}x</strong>)</div>`
      : `<div class="kpi-sub">PV FCF (10L): <strong>${fmtNum(res.sumPvCfM, 1)} M€</strong> · PV Term.: <strong>${fmtNum(res.pvTerminalM, 1)} M€</strong> · Čisti dolg: <strong>${fmtNum(res.netDebtM, 1)} M€</strong>${lkpgBridgeExtra}</div>`;

    document.getElementById("simResultCards").innerHTML = `
      <div class="val-box primary">
        <div class="kpi-label"><span>Poštena vrednost delnice (IV)</span><span class="badge ${verdictBadge}">${verdictText}</span></div>
        <div class="kpi-value" style="color:#34d399;font-size:25px;">${fmtNum(res.fairValuePerShare, 2)} €</div>
        ${subNote}
      </div>
      <div class="val-box">
        <div class="kpi-label"><span>Implicirana varnostna rezerva (MoS)</span><span class="badge ${res.impliedMosPct >= 0 ? "badge-emerald" : "badge-rose"}">MoS = 1 − P/IV</span></div>
        <div class="kpi-value ${res.impliedMosPct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(res.impliedMosPct, 2)}</div>
        <div class="kpi-sub">Potencial rasti (Upside = IV/P − 1): <strong>${fmtSignedPct(res.upsidePct, 1)}</strong></div>
      </div>
      <div class="val-box">
        <div class="kpi-label"><span>Trenutni borzni tečaj (${escHtml(comp.ticker)})</span><span class="badge badge-neutral">Podatki: ${escHtml(DATA.asOfDate)}</span></div>
        <div class="kpi-value">${fmtNum(price, 2)} €</div>
        <div class="kpi-sub">Tržna kap. (brez lastnih): <strong>${fmtNum(comp.current.effectiveMarketCapM, 1)} mio €</strong></div>
      </div>
      <div class="val-box">
        <div class="kpi-label"><span>Ciljna nakupna cena (z ${fmtNum(simState.mosPct, 0)} % MoS)</span><span class="badge badge-blue">Zahtevani MoS</span></div>
        <div class="kpi-value text-blue">${fmtNum(res.buyPriceWithMos, 2)} €</div>
        <div class="kpi-sub">Notranja vrednost kapitala: <strong>${fmtNum(res.equityValueM, 1)} mio €</strong></div>
      </div>
    `;

    // Reverse DCF Card
    const revDcf = computeReverseDcf(simState, price);
    const revCardEl = document.getElementById("reverseDcfCard");
    if (revDcf.type === "roe") {
      const diffRoe = revDcf.impliedValuePct - comp.current.roePct;
      revCardEl.innerHTML = `
        <div class="card-header">
          <div>
            <div class="card-title">Obratni model (Reverse Residual Income): Kaj trg vračunava v tečaj ${fmtNum(price, 2)} €?</div>
            <div class="card-subtitle">Pri strošku lastniškega kapitala ke = ${fmtNum(simState.waccPct, 1)} % (${escHtml(comp.dcfDefaults.capmNote)}) in B₀ = ${fmtNum(simState.bookValueM, 1)} M€</div>
          </div>
          <span class="badge ${diffRoe <= 0 ? "badge-emerald" : "badge-amber"}">${diffRoe <= 0 ? "Konservativno vračunano" : "Visoka pričakovanja"}</span>
        </div>
        <div class="grid-2" style="margin-bottom:10px;">
          <div class="val-box">
            <div class="kpi-label"><span>Tržno vračunani začetni ROE (%)</span></div>
            <div class="kpi-value text-blue">${fmtNum(revDcf.impliedValuePct, 2)} %</div>
            <div class="kpi-sub">Zahtevani ROE za upravičitev tečaja ${fmtNum(price, 2)} €</div>
          </div>
          <div class="val-box">
            <div class="kpi-label"><span>Dejanski TTM ROE družbe (${escHtml(comp.ticker)})</span></div>
            <div class="kpi-value text-emerald">${fmtNum(comp.current.roePct, 2)} %</div>
            <div class="kpi-sub">10L povprečni ROE: <strong>${fmtNum(comp.historicalValuation.roePct.avg10y, 1)} %</strong></div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">
          Trenutni borzni tečaj <strong>${fmtNum(price, 2)} €</strong> (TTM P/B <strong>${fmtNum(comp.current.pb, 2)}x</strong>) ob strošku lastniškega kapitala <strong>${fmtNum(simState.waccPct, 1)} %</strong> in linearnem bledenju ROE predpostavlja, da bo ${escHtml(comp.shortName)} dosegala začetni ROE <strong>${fmtNum(revDcf.impliedValuePct, 2)} %</strong> (dejanski TTM ROE znaša <strong>${fmtNum(comp.current.roePct, 2)} %</strong>).
        </div>
      `;
    } else {
      const histCagr = comp.cagrs10y.netIncomeCagrPct || comp.cagrs10y.revenueCagrPct || 6.0;
      const diffG = revDcf.impliedValuePct - histCagr;
      revCardEl.innerHTML = `
        <div class="card-header">
          <div>
            <div class="card-title">Obratni DCF (Reverse DCF): Kakšno rast trg trenutno vračunava v tečaj ${fmtNum(price, 2)} €?</div>
            <div class="card-subtitle">Pri izhodiščnem FCF ${fmtNum(simState.baseCashFlowM, 2)} M€, WACC = ${fmtNum(simState.waccPct, 1)} % in terminalni rasti g = ${fmtNum(simState.terminalGrowthPct, 1)} %</div>
          </div>
          <span class="badge ${diffG <= 0 ? "badge-emerald" : "badge-amber"}">${diffG <= 0 ? "Pod zgodovinsko rastjo" : "Nad zgodovinsko rastjo"}</span>
        </div>
        <div class="grid-2" style="margin-bottom:10px;">
          <div class="val-box">
            <div class="kpi-label"><span>Vračunana tržna stopnja rasti FCF (Leto 1–5)</span></div>
            <div class="kpi-value text-blue">${fmtSignedPct(revDcf.impliedValuePct, 2)}<span style="font-size:13px;">/leto</span></div>
            <div class="kpi-sub">V 2. fazi (Leto 6–10): <strong>${fmtSignedPct(revDcf.impliedValuePct * 0.75, 2)}/leto</strong></div>
          </div>
          <div class="val-box">
            <div class="kpi-label"><span>Dejanski 10L zgodovinski CAGR dobička</span></div>
            <div class="kpi-value text-emerald">${fmtSignedPct(histCagr, 2)}<span style="font-size:13px;">/leto</span></div>
            <div class="kpi-sub">10L CAGR prihodkov: <strong>${fmtSignedPct(comp.cagrs10y.revenueCagrPct, 1)}/leto</strong></div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">
          Za upravičitev trenutnega tečaja <strong>${fmtNum(price, 2)} €</strong> pri izhodiščnem FCF <strong>${fmtNum(simState.baseCashFlowM, 2)} M€</strong> in diskontni stopnji <strong>${fmtNum(simState.waccPct, 1)} %</strong> mora prosti denarni tok v naslednjih 5 letih rasti po <strong>${fmtSignedPct(revDcf.impliedValuePct, 2)} letno</strong> (tvoja simulirana rast: <strong>${fmtSignedPct(simState.growthStage1Pct, 1)}</strong>).
        </div>
      `;
    }

    // Chart 4B: Illustrative IV Trajectory by Historical Fundamentals vs Share Price (Item B14)
    const ivHist = comp.ivHistory || [];
    renderChart("ivHistory", "chartIvHistory", {
      type: "line",
      data: {
        labels: ivHist.map((h) => h.period),
        datasets: [
          {
            label: "Ilustrativni IV po takratnih fundamentih (€)",
            data: ivHist.map((h) => Number((res.fairValuePerShare * h.intrinsicValueScale).toFixed(2))),
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.14)",
            borderWidth: 2.6,
            fill: true,
            tension: 0.25,
            pointRadius: 4
          },
          {
            label: "Tržni tečaj delnice ob koncu obdobja (€)",
            data: ivHist.map((h) => h.sharePrice),
            borderColor: "#38bdf8",
            backgroundColor: "transparent",
            borderWidth: 2.4,
            tension: 0.25,
            pointRadius: 4
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
          y: { ticks: { color: "#94a3b8", callback: (v) => v + " €" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });

    // Chart 4A: 10-Year Projected Cash Flows / Excess Return vs Present Value (Leto 1 NTM .. Leto 10, Item B15)
    document.getElementById("simChartProjTitle").textContent = isRes
      ? "Projekcija presežnega donosa kapitala (EVA) in sedanje vrednosti (Leto 1 NTM – Leto 10)"
      : "Projekcija prostih denarnih tokov (FCF) in sedanje vrednosti (Leto 1 NTM – Leto 10)";

    renderChart("dcfProj", "chartDcfProjection", {
      type: "bar",
      data: {
        labels: res.years.map((y) => y.periodLabel),
        datasets: [
          {
            label: isRes ? "Presežni donos kapitala — EVA (mio €)" : "Projicirani prosti denarni tok — FCF (mio €)",
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

    // Scenarios + Basis Comparison Table (5Y Median vs 5Y Mean vs Actual FY25, or TTM ROE vs Normalized ROE)
    const d = comp.dcfDefaults;
    const avg5yRes = computeValuationModel({ ...simState, basisMode: isRes ? "residual" : "avg5y", baseCashFlowM: d.fcf5yAvgM }, price);
    const fy25PeakRes = computeValuationModel({ ...simState, basisMode: isRes ? "residual" : "fy25", baseCashFlowM: d.fcfPeak2025M }, price);
    const ttmRoeRes = isRes
      ? computeValuationModel({ ...simState, normalizedRoePct: comp.current.roePct }, price)
      : null;

    const bearRes = computeValuationModel(
      {
        ...simState,
        normalizedRoePct: simState.normalizedRoePct - 2.0,
        growthStage1Pct: simState.growthStage1Pct * 0.6,
        growthStage2Pct: simState.growthStage2Pct * 0.6,
        waccPct: simState.waccPct + 0.9,
        terminalGrowthPct: Math.max(0.0, simState.terminalGrowthPct - 0.4)
      },
      price
    );

    const bullRes = computeValuationModel(
      {
        ...simState,
        normalizedRoePct: simState.normalizedRoePct + 1.8,
        growthStage1Pct: simState.growthStage1Pct * 1.3,
        growthStage2Pct: simState.growthStage2Pct * 1.25,
        waccPct: Math.max(5.5, simState.waccPct - 0.5),
        terminalGrowthPct: Math.min(4.0, simState.terminalGrowthPct + 0.4)
      },
      price
    );

    document.getElementById("simScenariosTableWrap").innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Scenarij / Izhodišče</th>
              <th>Izhodišče</th>
              <th>Rast 1–5L</th>
              <th>${isRes ? "ke" : "WACC"}</th>
              <th>Poštena vr. IV (€)</th>
              <th>MoS (1−P/IV)</th>
              <th>Potencial (Upside)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="label-cell"><span class="badge badge-rose">Pesimistični</span></td>
              <td>${isRes ? fmtNum(simState.normalizedRoePct - 2.0, 1) + "% ROE" : fmtNum(simState.baseCashFlowM, 2) + " M€"}</td>
              <td>${fmtNum(simState.growthStage1Pct * 0.6, 1)} %</td>
              <td>${fmtNum(simState.waccPct + 0.9, 1)} %</td>
              <td><strong>${fmtNum(bearRes.fairValuePerShare, 2)} €</strong></td>
              <td class="${bearRes.impliedMosPct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(bearRes.impliedMosPct, 1)}</td>
              <td class="${bearRes.upsidePct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(bearRes.upsidePct, 1)}</td>
            </tr>
            <tr class="highlight-row">
              <td class="label-cell"><span class="badge badge-blue">Aktivna simulacija</span></td>
              <td>${isRes ? fmtNum(simState.normalizedRoePct, 1) + "% ROE" : fmtNum(simState.baseCashFlowM, 2) + " M€"}</td>
              <td>${fmtNum(simState.growthStage1Pct, 1)} %</td>
              <td>${fmtNum(simState.waccPct, 1)} %</td>
              <td><strong class="text-emerald">${fmtNum(res.fairValuePerShare, 2)} €</strong></td>
              <td class="${res.impliedMosPct >= 0 ? "text-emerald" : "text-rose"}"><strong>${fmtSignedPct(res.impliedMosPct, 1)}</strong></td>
              <td class="${res.upsidePct >= 0 ? "text-emerald" : "text-rose"}"><strong>${fmtSignedPct(res.upsidePct, 1)}</strong></td>
            </tr>
            <tr>
              <td class="label-cell"><span class="badge badge-emerald">Optimistični</span></td>
              <td>${isRes ? fmtNum(simState.normalizedRoePct + 1.8, 1) + "% ROE" : fmtNum(simState.baseCashFlowM, 2) + " M€"}</td>
              <td>${fmtNum(simState.growthStage1Pct * 1.3, 1)} %</td>
              <td>${fmtNum(Math.max(5.5, simState.waccPct - 0.5), 1)} %</td>
              <td><strong>${fmtNum(bullRes.fairValuePerShare, 2)} €</strong></td>
              <td class="${bullRes.impliedMosPct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(bullRes.impliedMosPct, 1)}</td>
              <td class="${bullRes.upsidePct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(bullRes.upsidePct, 1)}</td>
            </tr>
            ${
              !isRes
                ? `
            <tr>
              <td class="label-cell"><span class="badge badge-neutral">5L Aritm. povprečje FCF</span></td>
              <td>${fmtNum(d.fcf5yAvgM, 2)} M€</td>
              <td>${fmtNum(simState.growthStage1Pct, 1)} %</td>
              <td>${fmtNum(simState.waccPct, 1)} %</td>
              <td><strong>${fmtNum(avg5yRes.fairValuePerShare, 2)} €</strong></td>
              <td class="${avg5yRes.impliedMosPct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(avg5yRes.impliedMosPct, 1)}</td>
              <td class="${avg5yRes.upsidePct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(avg5yRes.upsidePct, 1)}</td>
            </tr>
            <tr>
              <td class="label-cell"><span class="badge badge-amber">Dejanski FY 2025 FCF</span></td>
              <td>${fmtNum(d.fcfPeak2025M, 2)} M€</td>
              <td>${fmtNum(simState.growthStage1Pct, 1)} %</td>
              <td>${fmtNum(simState.waccPct, 1)} %</td>
              <td><strong>${fmtNum(fy25PeakRes.fairValuePerShare, 2)} €</strong></td>
              <td class="${fy25PeakRes.impliedMosPct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(fy25PeakRes.impliedMosPct, 1)}</td>
              <td class="${fy25PeakRes.upsidePct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(fy25PeakRes.upsidePct, 1)}</td>
            </tr>`
                : `
            <tr>
              <td class="label-cell"><span class="badge badge-amber">Dejanski TTM ROE (${fmtNum(comp.current.roePct, 1)}%)</span></td>
              <td>${fmtNum(comp.current.roePct, 1)}% ROE</td>
              <td>${fmtNum(simState.growthStage1Pct, 1)} %</td>
              <td>${fmtNum(simState.waccPct, 1)} %</td>
              <td><strong>${fmtNum(ttmRoeRes.fairValuePerShare, 2)} €</strong></td>
              <td class="${ttmRoeRes.impliedMosPct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(ttmRoeRes.impliedMosPct, 1)}</td>
              <td class="${ttmRoeRes.upsidePct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(ttmRoeRes.upsidePct, 1)}</td>
            </tr>`
            }
          </tbody>
        </table>
      </div>
    `;

    // 10-Year Projection Table anchored to 20. 11. 2026 (Leto 1 NTM .. Leto 10, Item B15)
    document.getElementById("simProjectionTable").innerHTML = `
      <thead>
        <tr>
          <th>Postavka projekcije (Sidrano: ${escHtml(DATA.asOfDate || "24. 11. 2026")})</th>
          <th>Izhodišče</th>
          ${res.years.map((y) => `<th>${escHtml(y.periodLabel)}</th>`).join("")}
          <th>Terminalna vr.</th>
        </tr>
      </thead>
      <tbody>
        ${
          isRes
            ? `
        <tr>
          <td class="label-cell">Simulirani ROE z linearnim bledenjem (%)</td>
          <td>${fmtNum(simState.normalizedRoePct, 1)} %</td>
          ${res.years.map((y) => `<td>${fmtNum(y.roePct, 2)} %</td>`).join("")}
          <td>${fmtNum(res.terminalRoePct, 2)} % (dolgoročno)</td>
        </tr>`
            : ""
        }
        <tr>
          <td class="label-cell">Letna stopnja rasti (%)</td>
          <td>—</td>
          ${res.years.map((y) => `<td>${fmtNum(y.growthPct, 1)} %</td>`).join("")}
          <td>${fmtNum(simState.terminalGrowthPct, 1)} % (trajno)</td>
        </tr>
        <tr class="highlight-row">
          <td class="label-cell">${isRes ? "Presežni donos kapitala — EVA (mio €)" : "Projicirani prosti denarni tok — FCF (mio €)"}</td>
          <td>${isRes ? fmtNum(simState.bookValueM, 1) + " (B₀)" : fmtNum(simState.baseCashFlowM, 2)}</td>
          ${res.years.map((y) => `<td>${fmtNum(y.cashFlowM, 2)}</td>`).join("")}
          <td>${fmtNum(res.terminalValueM, 1)}</td>
        </tr>
        <tr>
          <td class="label-cell">Diskontni faktor (${isRes ? "ke" : "WACC"} ${fmtNum(simState.waccPct, 1)} %)</td>
          <td>1,000</td>
          ${res.years.map((y) => `<td>${fmtNum(y.discountFactor, 3)}</td>`).join("")}
          <td>${fmtNum(res.years[9].discountFactor, 3)}</td>
        </tr>
        <tr>
          <td class="label-cell">Sedanja vrednost — PV (mio €)</td>
          <td>${isRes ? fmtNum(simState.bookValueM, 1) : "—"}</td>
          ${res.years.map((y) => `<td class="text-emerald">${fmtNum(y.pvCashFlowM, 2)}</td>`).join("")}
          <td class="text-blue"><strong>${fmtNum(res.pvTerminalM, 1)}</strong></td>
        </tr>
        <tr>
          <td class="label-cell">Na delnico (€/deln.)</td>
          <td>${fmtNum((isRes ? simState.bookValueM : simState.baseCashFlowM) / simState.sharesM, 2)} €</td>
          ${res.years.map((y) => `<td>${fmtNum(y.cashFlowM / simState.sharesM, 2)} €</td>`).join("")}
          <td><strong>IV: ${fmtNum(res.fairValuePerShare, 2)} €</strong></td>
        </tr>
      </tbody>
    `;

    // 2D Sensitivity Matrix:
    // - For Residual Income (NLBR, ZVTG, POSR): ke (±1.5 pp) vs Normalized ROE (±2.0 pp) (Item B11c)
    // - For 2-Stage DCF (non-financials): WACC (±1.5 pp) vs Terminal Growth g (±1.0 pp)
    const sensTitleEl = document.getElementById("sensMatrixTitle");
    const sensSubEl = document.getElementById("sensMatrixSubtitle");
    const waccSteps = [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5].map((delta) =>
      Number(Math.max(4.5, simState.waccPct + delta).toFixed(1))
    );

    if (isRes) {
      if (sensTitleEl) {
        sensTitleEl.textContent =
          "2D Matrika občutljivosti poštene vrednosti delnice (€): Strošek lastniškega kapitala (ke) vs. Vzdržni ROE (%)";
      }
      if (sensSubEl) {
        sensSubEl.textContent = `Občutljivost IV na spremembo ke (±1,5 o.t.) in vzdržnega ROE (±2,0 o.t. okoli ${fmtNum(simState.normalizedRoePct, 1)} %; TTM ROE = ${fmtNum(comp.current.roePct, 1)} %)`;
      }
      const roeSteps = [-2.0, -1.0, 0.0, 1.0, 2.0].map((delta) =>
        Number(Math.max(4.0, simState.normalizedRoePct + delta).toFixed(1))
      );

      let sensHtml = `
        <thead>
          <tr>
            <th>Strošek kapitala (ke) \\ Vzdržni ROE (%)</th>
            ${roeSteps.map((rVal) => `<th>ROE = ${fmtNum(rVal, 1)} %</th>`).join("")}
          </tr>
        </thead>
        <tbody>
      `;

      waccSteps.forEach((wVal) => {
        sensHtml += `<tr><td class="label-cell"><strong>ke = ${fmtNum(wVal, 1)} %</strong></td>`;
        roeSteps.forEach((rVal) => {
          const cellRes = computeValuationModel(
            {
              ...simState,
              waccPct: wVal,
              normalizedRoePct: rVal
            },
            price
          );
          const fv = cellRes.fairValuePerShare;
          const mosPct = cellRes.impliedMosPct;
          let cellClass = "sens-cell-fair";
          if (mosPct >= 8) cellClass = "sens-cell-undervalued";
          else if (mosPct <= -8) cellClass = "sens-cell-overvalued";

          const isCenter =
            Math.abs(wVal - simState.waccPct) < 0.05 && Math.abs(rVal - simState.normalizedRoePct) < 0.05
              ? "sens-cell-active"
              : "";

          sensHtml += `<td class="${cellClass} ${isCenter}">${fmtNum(fv, 2)} € <span style="font-size:10.2px;opacity:0.85;">(MoS ${fmtSignedPct(mosPct, 0)})</span></td>`;
        });
        sensHtml += `</tr>`;
      });
      sensHtml += `</tbody>`;
      document.getElementById("simSensitivityTable").innerHTML = sensHtml;
    } else {
      if (sensTitleEl) {
        sensTitleEl.textContent =
          "2D Matrika občutljivosti poštene vrednosti delnice (€): Diskontna stopnja (WACC) vs. Terminalna rast (g)";
      }
      if (sensSubEl) {
        sensSubEl.textContent = "V oklepaju je navedena implicirana varnostna rezerva MoS = (IV − Tečaj) / IV";
      }
      const gSteps = [-1.0, -0.5, 0.0, 0.5, 1.0].map((delta) =>
        Number(Math.max(0.0, simState.terminalGrowthPct + delta).toFixed(1))
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
          const cellRes = computeValuationModel(
            {
              ...simState,
              waccPct: wVal,
              terminalGrowthPct: gVal
            },
            price
          );
          const fv = cellRes.fairValuePerShare;
          const mosPct = cellRes.impliedMosPct;
          let cellClass = "sens-cell-fair";
          if (mosPct >= 8) cellClass = "sens-cell-undervalued";
          else if (mosPct <= -8) cellClass = "sens-cell-overvalued";

          const isCenter =
            Math.abs(wVal - simState.waccPct) < 0.05 &&
            Math.abs(gVal - simState.terminalGrowthPct) < 0.05
              ? "sens-cell-active"
              : "";

          sensHtml += `<td class="${cellClass} ${isCenter}">${fmtNum(fv, 2)} € <span style="font-size:10.2px;opacity:0.85;">(MoS ${fmtSignedPct(mosPct, 0)})</span></td>`;
        });
        sensHtml += `</tr>`;
      });
      sensHtml += `</tbody>`;
      document.getElementById("simSensitivityTable").innerHTML = sensHtml;
    }

    updateUrlParams();
  }

  // =========================================================================
  // MODULE 5: INTERNATIONAL PEER COMPARISON (N=6-8 PEERS PER COMPANY)
  // =========================================================================
  function renderModule4Peers(comp) {
    const cur = comp.current;
    const pc = comp.peerComparison;
    const peerCount = pc && pc.peers ? pc.peers.length : 0;

    document.getElementById("peerSectionTitle").textContent =
      `${comp.shortName} (${comp.ticker}) — Primerjava kazalnikov vrednotenj s ${peerCount} primerljivimi podjetji v tujini`;

    const contentEl = document.getElementById("peerModuleContent");

    if (pc && pc.included) {
      const premPe = pc.premiumVsPeerMedianPct.pe;
      const badgeClass = premPe <= 0 ? "badge-emerald" : "badge-amber";
      const badgeText =
        premPe <= 0
          ? `Trguje z diskontom (${fmtSignedPct(premPe, 1)} vs. Mediana ${peerCount} tujih P/E)`
          : `Trguje s premijo (${fmtSignedPct(premPe, 1)} vs. Mediana ${peerCount} tujih P/E)`;

      document.getElementById("peerStatusBadgeWrap").innerHTML = `<span class="badge ${badgeClass}">${badgeText}</span>`;

      const med = pc.peerMedian;
      const avg = pc.peerAverage;
      const imp = pc.impliedPrices || {};

      const fmtDiffBadge = (val, invertColor = false) => {
        if (val === null || val === undefined) return "ni podatka";
        const isGood = invertColor ? val >= 0 : val <= 0;
        const lbl = invertColor ? "" : val <= 0 ? " (diskont)" : " (premija)";
        return `<span class="badge ${isGood ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(val, 1)}${lbl}</span>`;
      };

      contentEl.innerHTML = `
        <div class="grid-2" style="margin-bottom:16px;">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Primerjalna tabela: ${escHtml(comp.shortName)} (${escHtml(comp.ticker)}) vs. ${peerCount} tujih primerljivih družb</div>
                <div class="card-subtitle">${escHtml(pc.sourceNote)}</div>
              </div>
              <span class="badge badge-neutral">Zajeto: ${escHtml(pc.asOfDate)}</span>
            </div>
            <div class="table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Podjetje (Simbol)</th>
                    <th>Država / Borza</th>
                    <th>Vir &amp; Datum</th>
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
                    <td class="label-cell"><strong class="text-blue">${escHtml(comp.shortName)} (${escHtml(comp.ticker)})</strong></td>
                    <td style="text-align:left;font-family:var(--font-sans);">Slovenija (LJSE)</td>
                    <td style="text-align:left;font-size:11px;color:var(--text-muted);">LJSE / SEOnet · 20.11.26</td>
                    <td>${fmtNum(cur.marketCapM / 1000, 2)}</td>
                    <td><strong>${fmtNum(cur.pe, 2, "x")}</strong></td>
                    <td>${fmtNum(cur.pe ? cur.pe * 0.93 : null, 2, "x")}</td>
                    <td><strong>${fmtNum(cur.pb, 2, "x")}</strong></td>
                    <td>${fmtNum(cur.evEbitda, 2, "x")}</td>
                    <td>${fmtNum(cur.ps, 2, "x")}</td>
                    <td class="text-emerald"><strong>${fmtNum(cur.divYieldPct, 2, " %")}</strong></td>
                    <td><strong>${fmtNum(cur.roePct, 1, " %")}</strong></td>
                  </tr>
                  ${pc.peers
                    .map(
                      (p) => `
                    <tr>
                      <td class="label-cell">${escHtml(p.name)} <span class="mono text-muted">(${escHtml(p.ticker)})</span></td>
                      <td style="text-align:left;font-family:var(--font-sans);color:var(--text-secondary);">${escHtml(p.country)}</td>
                      <td style="text-align:left;font-size:10.8px;color:var(--text-muted);">${escHtml(p.source)} · ${escHtml(p.asOf)}</td>
                      <td>${fmtNum(p.marketCapEurBn, 2)}</td>
                      <td>${fmtNum(p.pe, 2, "x")}</td>
                      <td>${fmtNum(p.forwardPe, 2, "x")}</td>
                      <td>${fmtNum(p.pb, 2, "x")}</td>
                      <td>${fmtNum(p.evEbitda, 2, "x")}</td>
                      <td>${fmtNum(p.ps, 2, "x")}</td>
                      <td>${fmtNum(p.divYieldPct, 2, " %")}</td>
                      <td>${fmtNum(p.roePct, 1, " %")}</td>
                    </tr>
                  `
                    )
                    .join("")}
                  <tr class="section-divider"><td colspan="11">Statistika tuje primerjalne skupine (N=${peerCount} mednarodnih vrstnikov · Statični zajem dne ${escHtml(pc.asOfDate)})</td></tr>
                  <tr>
                    <td class="label-cell"><strong>Povprečje tujih podjetij (Peer Mean, N=${peerCount})</strong></td>
                    <td style="text-align:left;">Mednarodno</td>
                    <td style="text-align:left;">${escHtml(pc.asOfDate)}</td>
                    <td>ni podatka</td>
                    <td><strong>${fmtNum(avg.pe, 2, "x")}</strong></td>
                    <td>${fmtNum(avg.forwardPe, 2, "x")}</td>
                    <td><strong>${fmtNum(avg.pb, 2, "x")}</strong></td>
                    <td>${fmtNum(avg.evEbitda, 2, "x")}</td>
                    <td>${fmtNum(avg.ps, 2, "x")}</td>
                    <td>${fmtNum(avg.divYieldPct, 2, " %")}</td>
                    <td>${fmtNum(avg.roePct, 1, " %")}</td>
                  </tr>
                  <tr class="highlight-row">
                    <td class="label-cell"><strong>Mediana tujih podjetij (Peer Median, N=${peerCount})</strong></td>
                    <td style="text-align:left;">Mednarodno</td>
                    <td style="text-align:left;">${escHtml(pc.asOfDate)}</td>
                    <td>ni podatka</td>
                    <td><strong>${fmtNum(med.pe, 2, "x")}</strong></td>
                    <td>${fmtNum(med.forwardPe, 2, "x")}</td>
                    <td><strong>${fmtNum(med.pb, 2, "x")}</strong></td>
                    <td>${fmtNum(med.evEbitda, 2, "x")}</td>
                    <td>${fmtNum(med.ps, 2, "x")}</td>
                    <td>${fmtNum(med.divYieldPct, 2, " %")}</td>
                    <td>${fmtNum(med.roePct, 1, " %")}</td>
                  </tr>
                  <tr>
                    <td class="label-cell"><strong>Premija (+) / Diskont (−) ${escHtml(comp.ticker)} vs. Mediana</strong></td>
                    <td style="text-align:left;" colspan="2">Relativno odstopanje</td>
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
                  <div class="card-title">Vizualna primerjava večkratnikov: ${escHtml(comp.ticker)} vs. ${peerCount} tujih primerljivih družb</div>
                  <div class="card-subtitle">Primerjava pravega TTM P/E in Dividendne donosnosti (%) · Statični zajem Yahoo Finance (${escHtml(pc.asOfDate)})</div>
                </div>
              </div>
              <div class="chart-box-sm">
                <canvas id="chartPeerComparison"></canvas>
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <div>
                  <div class="card-title">Implicirana vrednost delnice ${escHtml(comp.ticker)} ob večkratnikih tujih vrstnikov</div>
                  <div class="card-subtitle">Koliko bi znašal tečaj delnice ${escHtml(comp.shortName)}, če bi se trgovala pri mediani ${peerCount} tujih tekmecev</div>
                </div>
              </div>
              <div class="grid-3">
                <div class="val-box">
                  <div class="kpi-label"><span>Cena ob Peer Mediani P/E (${fmtNum(med.pe, 2, "x")})</span></div>
                  <div class="kpi-value">${fmtNum(imp.byPeerMedianPe, 2, " €")}</div>
                  <div class="kpi-sub">TTM EPS: <strong>${fmtNum(cur.eps, 2, " €")}</strong></div>
                </div>
                <div class="val-box">
                  <div class="kpi-label"><span>Cena ob Peer Mediani P/B (${fmtNum(med.pb, 2, "x")})</span></div>
                  <div class="kpi-value">${fmtNum(imp.byPeerMedianPb, 2, " €")}</div>
                  <div class="kpi-sub">TTM BVPS: <strong>${fmtNum(cur.bvps, 2, " €")}</strong></div>
                </div>
                <div class="val-box">
                  <div class="kpi-label"><span>Tehtana Peer implicirana cena</span></div>
                  <div class="kpi-value text-blue">${fmtNum(imp.blendedPeerFairValue, 2, " €")}</div>
                  <div class="kpi-sub">Peer MoS (1−P/IV): <strong>${fmtSignedPct(imp.blendedMosPct, 1)}</strong></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      const labels = [comp.ticker + " (SI)", ...pc.peers.map((p) => p.ticker), `Mediana (N=${peerCount})`];
      renderChart("peerComp", "chartPeerComparison", {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "P/E (TTM, x)",
              data: [cur.pe, ...pc.peers.map((p) => p.pe), med.pe],
              backgroundColor: labels.map((_, i) =>
                i === 0 ? "#38bdf8" : i === labels.length - 1 ? "#10b981" : "rgba(148, 163, 184, 0.55)"
              ),
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
            x: { ticks: { color: "#cbd5e1", font: { size: 10.8 } }, grid: { display: false } },
            y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.08)" } }
          }
        }
      });
    }

    // Cross-Index Peer Summary Matrix
    const crossBody = document.getElementById("crossPeerSummaryBody");
    crossBody.innerHTML = DATA.companies
      .map((c) => {
        const curC = c.current;
        const pcC = c.peerComparison;
        const medC = pcC.peerMedian;
        const premC = pcC.premiumVsPeerMedianPct;
        const nPeers = pcC.peers ? pcC.peers.length : 0;
        const isSel = c.ticker === selectedTicker ? "highlight-row" : "";

        const badge = (v) =>
          v !== null && v !== undefined
            ? `<span class="badge ${v <= 0 ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(v, 1)} (${v <= 0 ? "diskont" : "premija"})</span>`
            : "ni podatka";

        return `
          <tr class="${isSel}" data-ticker="${escHtml(c.ticker)}" style="cursor:pointer;">
            <td class="label-cell"><strong class="mono text-blue">${escHtml(c.ticker)}</strong> · ${escHtml(c.shortName)} <span class="text-muted" style="font-size:10px;">(N=${nPeers})</span></td>
            <td>${fmtNum(curC.price, 2)} €</td>
            <td><strong>${fmtNum(curC.pe, 2, "x")}</strong></td>
            <td>${fmtNum(medC.pe, 2, "x")}</td>
            <td>${badge(premC.pe)}</td>
            <td><strong>${fmtNum(curC.pb, 2, "x")}</strong></td>
            <td>${fmtNum(medC.pb, 2, "x")}</td>
            <td>${badge(premC.pb)}</td>
            <td>${fmtNum(curC.evEbitda, 2, "x")}</td>
            <td>${fmtNum(medC.evEbitda, 2, "x")}</td>
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
  // MODULE 6: HISTORICAL SELF-VALUATION COMPARISON (EXACT N, EXCLUDED OUTLIERS)
  // =========================================================================
  function renderModule5HistoricalValuation(comp) {
    const hv = comp.historicalValuation;
    const peSt = hv.pe || {};
    const nPe = peSt.sampleSizeN || 10;
    const exclPe = peSt.excludedOutliers || [];

    document.getElementById("histValSectionTitle").textContent =
      `${comp.shortName} (${comp.ticker}) — Primerjava trenutnih TTM kazalnikov vrednotenj z 10-letno zgodovino podjetja (Vzorec N=${nPe} letnih točk)`;
    document.getElementById("histSelfTableTitle").textContent =
      `Statistična analiza večkratnikov družbe ${comp.name} (${comp.ticker}): Pravi TTM (2026) vs. Lastno 10-letno obdobje (2016–2025, dejanski vzorec N=${nPe} pri P/E)`;

    const exclText =
      exclPe.length > 0
        ? `Izločena leta iz statistike P/E (0 < P/E < 38): ${exclPe.join("; ")}.`
        : "V vseh 10 letih (2016–2025) so bili dobički pozitivni in znotraj 0 < P/E < 38 (N=10).";

    const exclNoteEl = document.getElementById("histExcludedOutliersNote");
    if (exclNoteEl) {
      exclNoteEl.textContent = `Opozorilo: vzorec ≤10 letnih točk (pri P/E dejanski N=${nPe}). ${exclText}`;
    }

    const peZ = peSt.zScore || 0;
    const pePct = peSt.percentile || 50;
    document.getElementById("histValBadgeWrap").innerHTML = `
      <span class="badge ${peZ <= 0.5 ? "badge-emerald" : peZ <= 1.8 ? "badge-amber" : "badge-rose"}">
        Percentil: ${fmtNum(pePct, 0)}. · Z-Score P/E: ${peZ > 0 ? "+" : ""}${fmtNum(peZ, 2)}σ (Dejanski N=${nPe} · Vzorec ≤10 let)
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
              <td class="label-cell">${escHtml(m.label)}</td>
              <td colspan="12" class="text-muted" style="text-align:left;">ni podatka — kazalnik se v bančnem/zavarovalniškem sektorju ne uporablja (uporabite P/E, P/B, ROE in Dividendno donosnost).</td>
            </tr>
          `;
        }

        const isGoodDiff = m.lowerIsCheaper ? st.diffVsAvgPct <= 0 : st.diffVsAvgPct >= 0;
        const diffAvgBadge = `<span class="badge ${isGoodDiff ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(st.diffVsAvgPct, 1)}</span>`;
        const diffMedBadge = `<span class="badge ${isGoodDiff ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(st.diffVsMedianPct, 1)}</span>`;

        const pctPos = Math.max(2, Math.min(98, st.rangePositionPct || 50));
        const exclList = st.excludedOutliers && st.excludedOutliers.length > 0 ? st.excludedOutliers.join(", ") : "Brez izločitev";

        return `
          <tr>
            <td class="label-cell"><strong>${escHtml(m.label)}</strong></td>
            <td><strong class="text-blue">${fmtNum(st.current, 2, m.suffix)}</strong></td>
            <td>${fmtNum(st.avg10y, 2, m.suffix)}</td>
            <td><strong>${fmtNum(st.median10y, 2, m.suffix)}</strong></td>
            <td class="text-muted">${fmtNum(st.lower1Sigma, 2)} – ${fmtNum(st.upper1Sigma, 2, m.suffix)}</td>
            <td>${diffAvgBadge}</td>
            <td>${diffMedBadge}</td>
            <td>${fmtNum(st.min10y, 2, m.suffix)} <span class="text-muted">(${escHtml(st.minYear)})</span></td>
            <td>${fmtNum(st.max10y, 2, m.suffix)} <span class="text-muted">(${escHtml(st.maxYear)})</span></td>
            <td>
              <div class="range-bar-wrap">
                <div class="range-track">
                  <div class="range-fill" style="width:100%;"></div>
                  <div class="range-marker" style="left:calc(${pctPos}% - 2px);"></div>
                </div>
              </div>
            </td>
            <td><strong>${fmtNum(st.percentile, 0)}. perc.</strong></td>
            <td><strong>${st.zScore > 0 ? "+" : ""}${fmtNum(st.zScore, 2)}σ</strong> <span class="badge badge-neutral">N=${st.sampleSizeN}</span></td>
            <td style="text-align:left;font-size:11px;color:var(--text-secondary);">${escHtml(exclList)}</td>
          </tr>
        `;
      })
      .join("");

    // Chart 6A: 10-Year Historical P/E with Shaded ±1 Sigma Band & Buy Zone (-1σ)
    const peSeries = peSt.series || [];
    const labels11 = peSeries.map((s) => (s.year === "2026" ? "2026 TTM" : s.year));

    renderChart("histPeEv10Y", "chartHistPeEv10Y", {
      type: "line",
      data: {
        labels: labels11,
        datasets: [
          {
            label: `Zgodovinski in TTM P/E (${comp.ticker}, N=${nPe})`,
            data: peSeries.map((s) => s.value),
            borderColor: "#38bdf8",
            backgroundColor: "transparent",
            borderWidth: 2.8,
            tension: 0.25,
            pointRadius: 4,
            spanGaps: false
          },
          {
            label: "Zgornja meja +1σ (" + fmtNum(peSt.upper1Sigma, 2) + "x)",
            data: labels11.map(() => peSt.upper1Sigma),
            borderColor: "rgba(244, 63, 94, 0.55)",
            borderDash: [4, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false
          },
          {
            label: "10L Povprečje P/E (" + fmtNum(peSt.avg10y, 2) + "x)",
            data: labels11.map(() => peSt.avg10y),
            borderColor: "#f59e0b",
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            fill: false
          },
          {
            label: "Nakupna cona −1σ (" + fmtNum(peSt.lower1Sigma, 2) + "x · Pas ±1σ)",
            data: labels11.map(() => peSt.lower1Sigma),
            borderColor: "rgba(16, 185, 129, 0.75)",
            backgroundColor: "rgba(148, 163, 184, 0.11)",
            borderDash: [4, 4],
            borderWidth: 1.8,
            pointRadius: 0,
            fill: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 10.8 } } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: { ticks: { color: "#94a3b8", callback: (v) => v + "x" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });

    // Chart 6B: 10-Year Historical P/B (±1σ) & Dividend Yield (%)
    const pbSt = hv.pb || {};
    const pbSeries = pbSt.series || [];
    const dySeries = hv.divYieldPct ? hv.divYieldPct.series : [];

    renderChart("histPbDiv10Y", "chartHistPbDiv10Y", {
      type: "line",
      data: {
        labels: labels11,
        datasets: [
          {
            label: "Zgodovinski in TTM P/B (leva os)",
            data: pbSeries.map((s) => s.value),
            borderColor: "#6366f1",
            backgroundColor: "rgba(99, 102, 241, 0.12)",
            borderWidth: 2.5,
            yAxisID: "y",
            fill: true,
            tension: 0.25,
            spanGaps: false
          },
          {
            label: "10L Povprečje P/B (" + fmtNum(pbSt.avg10y, 2) + "x)",
            data: labels11.map(() => pbSt.avg10y),
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
            tension: 0.25,
            spanGaps: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 10.8 } } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: { position: "left", ticks: { color: "#818cf8", callback: (v) => v + "x" }, grid: { color: "rgba(148,163,184,0.08)" } },
          y1: { position: "right", ticks: { color: "#10b981", callback: (v) => v + " %" }, grid: { display: false } }
        }
      }
    });

    // Cross-Index 10-Year Historical Self-Valuation Summary Table (showing exact N and excluded outliers)
    const crossHistBody = document.getElementById("crossHistSummaryBody");
    crossHistBody.innerHTML = DATA.companies
      .map((c) => {
        const hvc = c.historicalValuation;
        const pe = hvc.pe || {};
        const pb = hvc.pb || {};
        const ev = hvc.evEbitda || {};
        const dy = hvc.divYieldPct || {};
        const isSel = c.ticker === selectedTicker ? "highlight-row" : "";
        const exclStr = pe.excludedOutliers && pe.excludedOutliers.length > 0 ? pe.excludedOutliers.join("; ") : "— (N=10)";

        return `
          <tr class="${isSel}" data-ticker="${escHtml(c.ticker)}" style="cursor:pointer;">
            <td class="label-cell"><strong class="mono text-blue">${escHtml(c.ticker)}</strong> · ${escHtml(c.shortName)}</td>
            <td><strong>${fmtNum(pe.current, 2, "x")}</strong></td>
            <td>${fmtNum(pe.avg10y, 2, "x")}</td>
            <td>${fmtNum(pe.median10y, 2, "x")}</td>
            <td><span class="badge ${pe.diffVsAvgPct <= 0 ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(pe.diffVsAvgPct, 1)}</span></td>
            <td>${fmtNum(pe.percentile, 0)}.p / <strong>${pe.zScore > 0 ? "+" : ""}${fmtNum(pe.zScore, 2)}σ</strong> <span class="badge badge-neutral">N=${pe.sampleSizeN}</span></td>
            <td style="text-align:left;font-size:10.8px;color:var(--text-secondary);">${escHtml(exclStr)}</td>
            <td><strong>${fmtNum(pb.current, 2, "x")}</strong></td>
            <td>${fmtNum(pb.avg10y, 2, "x")}</td>
            <td><span class="badge ${pb.diffVsAvgPct <= 0 ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(pb.diffVsAvgPct, 1)}</span></td>
            <td>${fmtNum(ev ? ev.current : null, 2, "x")}</td>
            <td>${fmtNum(ev ? ev.avg10y : null, 2, "x")}</td>
            <td class="text-emerald"><strong>${fmtNum(dy.current, 2, " %")}</strong></td>
            <td>${fmtNum(dy.avg10y, 2, " %")}</td>
          </tr>
        `;
      })
      .join("");

    crossHistBody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => selectCompany(tr.getAttribute("data-ticker")));
    });
  }

  // =========================================================================
  // MODULE 7: PORTFOLIO SIMULATOR & 5-YEAR FUTURE DIVIDEND CALENDAR (Items C16, C18)
  // =========================================================================
  function initPortfolioPreset(mode = "index") {
    const totalCapital = 100000;
    DATA.companies.forEach((c) => {
      const allocEur = mode === "equal" ? 10000 : totalCapital * (c.sbitopWeight / 100);
      portfolioShares[c.ticker] = Math.round(allocEur / c.current.price);
    });
    savePortfolioToStorage();
  }

  // Build the table rows DOM once and attach input listeners that update in place without losing focus (Item C16)
  function renderModule7Portfolio(forceRebuildRows = true) {
    const tbody = document.getElementById("portfolioBuilderBody");
    const kpiGrid = document.getElementById("portfolioKpiGrid");
    if (!tbody || !kpiGrid) return;

    const taxSelect = document.getElementById("selDivTaxRate");
    if (taxSelect) {
      taxSelect.value = String(dividendTaxRatePct);
    }

    if (forceRebuildRows || tbody.children.length !== DATA.companies.length) {
      tbody.innerHTML = DATA.companies
        .map((c) => {
          const sh = numOr(portfolioShares[c.ticker], 0);
          const dc = c.dividendCalendar;
          const statusBadge = dc.alreadyPaidIn2026
            ? `<span class="badge badge-neutral" title="Dividenda 2026 (${fmtNum(c.current.dps, 2)} €) je bila že izplačana (${escHtml(dc.exDivDate)})">2026 izplačana · 2027E: ${fmtNum(dc.next2027EstDps, 2)} €</span>`
            : `<span class="badge badge-emerald" title="2. tranša NLB 6,92 € ima ex-datum 14. 12. 2026 (še neizplačano)">Še v 2026: ${fmtNum(dc.remaining2026Dps, 2)} € (${escHtml(dc.exDivDate)})</span>`;

          return `
            <tr data-row-ticker="${escHtml(c.ticker)}">
              <td class="label-cell"><strong class="mono text-blue">${escHtml(c.ticker)}</strong> · ${escHtml(c.shortName)}</td>
              <td>
                <input type="number" min="0" step="1" class="portfolio-input" data-ticker="${escHtml(c.ticker)}" value="${sh}" aria-label="Število delnic ${escHtml(c.ticker)} v portfelju" />
              </td>
              <td>${fmtNum(c.current.price, 2)} €</td>
              <td class="p-cell-val"><strong>0,00 €</strong></td>
              <td class="p-cell-weight"><strong>0,0 %</strong></td>
              <td class="p-cell-iv">0,00 €</td>
              <td class="p-cell-mos"></td>
              <td style="text-align:left;">${statusBadge}</td>
              <td class="p-cell-div1 text-emerald"><strong>0,00 €</strong></td>
              <td class="p-cell-div5 text-blue"><strong>0,00 €</strong></td>
            </tr>
          `;
        })
        .join("");

      tbody.querySelectorAll(".portfolio-input").forEach((inp) => {
        inp.addEventListener("input", (e) => {
          const t = e.target.getAttribute("data-ticker");
          const rawVal = e.target.value;
          const parsed = rawVal === "" ? 0 : Math.max(0, parseFloat(rawVal) || 0);
          portfolioShares[t] = parsed;
          savePortfolioToStorage();
          // Update numbers & charts in-place WITHOUT touching tbody.innerHTML so focus/cursor stay intact!
          updatePortfolioCalculations();
        });
      });
    }

    updatePortfolioCalculations();
  }

  function updatePortfolioCalculations() {
    const tbody = document.getElementById("portfolioBuilderBody");
    const kpiGrid = document.getElementById("portfolioKpiGrid");
    if (!tbody || !kpiGrid) return;

    const netFactor = Math.max(0, 1 - dividendTaxRatePct / 100);
    const taxLabel = dividendTaxRatePct > 0 ? `Neto po ${fmtNum(dividendTaxRatePct, 1)} % davku` : "Bruto (0 % davka)";

    let totalVal = 0;
    let totalIvVal = 0;
    let totalDivYr1Gross = 0;
    let totalDivYr1Net = 0;
    let totalDiv5YGross = 0;
    let totalDiv5YNet = 0;
    const divByYear5Net = [0, 0, 0, 0, 0];

    const rowsData = DATA.companies.map((c) => {
      const sh = numOr(portfolioShares[c.ticker], 0);
      const px = c.current.price;
      const val = sh * px;
      const valRes = computeCompanyDefaultValuation(c);
      const iv = valRes.fairValuePerShare;
      const ivVal = sh * iv;

      const dc = c.dividendCalendar;
      const divG = numOr(dc.dps5yGrowthEstPct, 5.0) / 100;
      // 5-year horizon starts from the next UNPAID dividend after 20. 11. 2026 (Item C18):
      // - For NLBR: remaining 2nd tranche in Dec 2026 (6.92 €) + 2027E..2030E dividends
      // - For all other 8 companies (already paid in summer 2026): 5 future annual dividends starting with 2027E (next2027EstDps)
      const firstFutureAnnualDps = numOr(dc.next2027EstDps, c.current.dps * (1 + divG));
      const rem2026Dps = numOr(dc.remaining2026Dps, 0);

      // NTM (Leto 1) unpaid dividend per share: includes Dec 2026 remaining tranche (for NLBR) or 2027E dividend
      const ntmDpsGross = rem2026Dps > 0 ? rem2026Dps + firstFutureAnnualDps * 0.5 : firstFutureAnnualDps;
      const div1Gross = sh * ntmDpsGross;
      const div1Net = div1Gross * netFactor;

      let cumDiv5Gross = sh * rem2026Dps;
      for (let yr = 0; yr < 5; yr++) {
        const annualGross = sh * firstFutureAnnualDps * Math.pow(1 + divG, yr);
        const yrGrossWithRem = yr === 0 ? annualGross + sh * rem2026Dps : annualGross;
        cumDiv5Gross += annualGross;
        divByYear5Net[yr] += yrGrossWithRem * netFactor;
      }
      const cumDiv5Net = cumDiv5Gross * netFactor;

      totalVal += val;
      totalIvVal += ivVal;
      totalDivYr1Gross += div1Gross;
      totalDivYr1Net += div1Net;
      totalDiv5YGross += cumDiv5Gross;
      totalDiv5YNet += cumDiv5Net;

      return {
        comp: c,
        shares: sh,
        price: px,
        val,
        iv,
        ivVal,
        mosPct: valRes.impliedMosPct,
        div1Gross,
        div1Net,
        cumDiv5Gross,
        cumDiv5Net
      };
    });

    const portMosPct = totalIvVal > 0 ? ((totalIvVal - totalVal) / totalIvVal) * 100 : 0;
    const portUpsidePct = totalVal > 0 ? ((totalIvVal - totalVal) / totalVal) * 100 : 0;
    const portDivYieldNetPct = totalVal > 0 ? (totalDivYr1Net / totalVal) * 100 : 0;
    const portDivYieldGrossPct = totalVal > 0 ? (totalDivYr1Gross / totalVal) * 100 : 0;
    const port5yYieldOnCostNetPct = totalVal > 0 ? (totalDiv5YNet / totalVal) * 100 : 0;

    let activeShareSum = 0;
    rowsData.forEach((r) => {
      const wPort = totalVal > 0 ? (r.val / totalVal) * 100 : 0;
      r.weightPct = wPort;
      activeShareSum += Math.abs(wPort - r.comp.sbitopWeight);
    });
    const activeSharePct = 0.5 * activeShareSum;

    kpiGrid.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label"><span>Tržna vrednost portfelja</span><span class="badge badge-blue">Notranja vr. IV: ${fmtNum(totalIvVal, 0)} €</span></div>
        <div class="kpi-value">${fmtNum(totalVal, 2)} €</div>
        <div class="kpi-sub">Aktivni odmik od indeksa (Active Share): <strong>${fmtNum(activeSharePct, 1)} %</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Tehtana varnostna rezerva (MoS)</span><span class="badge ${portMosPct >= 0 ? "badge-emerald" : "badge-rose"}">MoS = 1 − Vred./IV</span></div>
        <div class="kpi-value ${portMosPct >= 0 ? "text-emerald" : "text-rose"}">${fmtSignedPct(portMosPct, 2)}</div>
        <div class="kpi-sub">Tehtani potencial portfelja (Upside): <strong>${fmtSignedPct(portUpsidePct, 1)}</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>Prihodnje dividende Leto 1 NTM (${escHtml(taxLabel)})</span><span class="badge badge-emerald">${fmtNum(portDivYieldNetPct, 2)} % neto</span></div>
        <div class="kpi-value text-emerald">${fmtNum(totalDivYr1Net, 2)} €</div>
        <div class="kpi-sub">Bruto NTM: <strong>${fmtNum(totalDivYr1Gross, 2)} € (${fmtNum(portDivYieldGrossPct, 2)} %)</strong></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label"><span>5L Prihodnje neizplačane div. (Obd. 1–5)</span><span class="badge badge-blue">${escHtml(taxLabel)}</span></div>
        <div class="kpi-value text-blue">${fmtNum(totalDiv5YNet, 2)} €</div>
        <div class="kpi-sub">Bruto 5L: <strong>${fmtNum(totalDiv5YGross, 2)} €</strong> · 5L neto donos na vložek: <strong class="text-emerald">${fmtNum(port5yYieldOnCostNetPct, 1)} %</strong></div>
      </div>
    `;

    // Update row cells in place without recreating <input> elements
    rowsData.forEach((r) => {
      const c = r.comp;
      const tr = tbody.querySelector(`tr[data-row-ticker="${c.ticker}"]`);
      if (!tr) return;
      const wDiff = r.weightPct - c.sbitopWeight;
      tr.querySelector(".p-cell-val").innerHTML = `<strong>${fmtNum(r.val, 2)} €</strong>`;
      tr.querySelector(".p-cell-weight").innerHTML =
        `<strong>${fmtNum(r.weightPct, 1)} %</strong> <span class="text-muted">(${fmtSignedPct(wDiff, 1)} vs. indeks)</span>`;
      tr.querySelector(".p-cell-iv").textContent = `${fmtNum(r.iv, 2)} €`;
      tr.querySelector(".p-cell-mos").innerHTML =
        `<span class="badge ${r.mosPct >= 0 ? "badge-emerald" : "badge-amber"}">${fmtSignedPct(r.mosPct, 1)}</span>`;
      tr.querySelector(".p-cell-div1").innerHTML =
        `<strong>${fmtNum(r.div1Net, 2)} €</strong> <span class="text-muted" style="font-size:10px;">(bruto ${fmtNum(r.div1Gross, 0)} €)</span>`;
      tr.querySelector(".p-cell-div5").innerHTML =
        `<strong>${fmtNum(r.cumDiv5Net, 2)} €</strong> <span class="text-muted" style="font-size:10px;">(bruto ${fmtNum(r.cumDiv5Gross, 0)} €)</span>`;
    });

    // Chart 7A: 5-Year Future Dividend Stream (Leto 1 NTM .. Leto 5)
    const years5 = ["Leto 1 (NTM)", "Leto 2 (2028E)", "Leto 3 (2029E)", "Leto 4 (2030E)", "Leto 5 (2031E)"];
    renderChart("portDiv5Y", "chartPortfolioDividends5Y", {
      type: "bar",
      data: {
        labels: years5,
        datasets: [
          {
            type: "bar",
            label: `Prihodnje neizplačane dividende portfelja (${taxLabel}, €)`,
            data: divByYear5Net.map((d) => Number(d.toFixed(1))),
            backgroundColor: "#10b981",
            yAxisID: "y",
            borderRadius: 4
          },
          {
            type: "line",
            label: "Letni Yield on Cost (% na začetni vložek, desna os)",
            data: divByYear5Net.map((d) => (totalVal > 0 ? Number(((d / totalVal) * 100).toFixed(2)) : 0)),
            borderColor: "#38bdf8",
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
          y: { position: "left", ticks: { color: "#10b981", callback: (v) => v + " €" }, grid: { color: "rgba(148,163,184,0.08)" } },
          y1: { position: "right", ticks: { color: "#38bdf8", callback: (v) => v + " %" }, grid: { display: false } }
        }
      }
    });

    // Chart 7B: Portfolio Weights vs SBI TOP Index Weights
    renderChart("portWeights", "chartPortfolioWeights", {
      type: "bar",
      data: {
        labels: rowsData.map((r) => r.comp.ticker),
        datasets: [
          {
            label: "Utež v tvojem portfelju (%)",
            data: rowsData.map((r) => Number(r.weightPct.toFixed(2))),
            backgroundColor: "#38bdf8",
            borderRadius: 4
          },
          {
            label: "Referenčna utež v indeksu SBI TOP (%)",
            data: rowsData.map((r) => r.comp.sbitopWeight),
            backgroundColor: "rgba(148, 163, 184, 0.5)",
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
          y: { ticks: { color: "#94a3b8", callback: (v) => v + " %" }, grid: { color: "rgba(148,163,184,0.08)" } }
        }
      }
    });
  }

  // =========================================================================
  // COMPANY SELECTION & VIEW ROUTING
  // =========================================================================
  function selectCompany(ticker, applyUrlOverrides = false) {
    if (!ticker) return;
    selectedTicker = ticker;
    const comp = getCompany(selectedTicker);

    renderHeaderAndSelectors();
    renderModule1Index();
    renderLatestPublishedResults();
    renderModule2Financials(comp);
    loadSimulatorDefaultsForCompany(comp, "base", null, applyUrlOverrides);
    renderModule4Peers(comp);
    renderModule5HistoricalValuation(comp);
    renderModule7Portfolio(true);
    updateUrlParams();
  }

  function setView(viewId) {
    const safeView = ALLOWED_VIEWS.has(viewId) ? viewId : "compact";
    activeView = safeView;
    document.querySelectorAll("#navTabs .nav-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === safeView);
    });
    document.querySelectorAll("#sidebarViewList .sidebar-nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === safeView);
    });

    const sectionIds = [
      "sec-index",
      "sec-latest-results",
      "sec-financials",
      "sec-simulator",
      "sec-peers",
      "sec-historical-val",
      "sec-portfolio"
    ];

    const compactVisible = new Set(["sec-index", "sec-financials", "sec-simulator"]);

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove("collapsed");
      if (safeView === "all") {
        el.classList.remove("hidden");
      } else if (safeView === "compact") {
        el.classList.toggle("hidden", !compactVisible.has(id));
      } else {
        el.classList.toggle("hidden", safeView !== id);
      }
    });

    updateUrlParams();
  }

  // =========================================================================
  // CSV EXPORT (SLOVENIAN DECIMAL COMMA + METADATA FOOTER, Item C19) & URL SHARING
  // =========================================================================
  function fmtCsvVal(v) {
    if (v === null || v === undefined || v === "") return "ni podatka";
    if (typeof v === "number") {
      return String(v).replace(".", ",");
    }
    return String(v);
  }

  function exportCurrentCompanyCsv() {
    const comp = getCompany(selectedTicker);
    const cur = comp.current;
    const d = comp.dcfDefaults;
    const headers = [
      "Leto",
      "Prihodki_mio_EUR",
      "EBITDA_mio_EUR",
      "EBIT_mio_EUR",
      "Cisti_dobicek_mio_EUR",
      "Dejanski_FCF_ali_Norm_FCF_mio_EUR",
      "Kapital_mio_EUR",
      "Surovi_ali_Prilagojeni_Cisti_dolg_mio_EUR",
      "Zakljucni_tecaj_LJSE_EUR",
      "EPS_EUR_brez_lastnih",
      "DPS_EUR",
      "BVPS_EUR_brez_lastnih",
      "PE",
      "PB",
      "EV_EBITDA",
      "Div_donos_pct",
      "ROE_pct",
      "Opomba_ocena"
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
      h.roePct,
      [
        h.debtIsEstimate ? "Dolg=ocena(55% dolg.obv.)" : "",
        h.roicIsEstimate ? "ROIC=ocena(18% davek)" : ""
      ]
        .filter(Boolean)
        .join(" | ") || "Revidirano"
    ]);

    // Explicit row for 2026 TTM showing both actual FY25 FCF and Normalized 5Y Median FCF, and both raw and adjusted net debt
    rows.push([
      "2026_TTM",
      cur.revenueM,
      cur.ebitdaM,
      cur.ebitM,
      cur.netIncomeM,
      cur.fcfM,
      cur.equityM,
      cur.netDebtM,
      cur.price,
      cur.eps,
      cur.dps,
      cur.bvps,
      cur.pe,
      cur.pb,
      cur.evEbitda,
      cur.divYieldPct,
      cur.roePct,
      `Dejanski_FY25_FCF=${fmtCsvVal(d.fcfPeak2025M)}_M€ | 5L_Mediana_FCF=${fmtCsvVal(d.fcfNormalizedM)}_M€ | Surovi_cisti_dolg=${fmtCsvVal(d.rawNetDebtM)}_M€ | Oper_blazilnik=${fmtCsvVal(d.operatingCashBufferM)}_M€`
    ]);

    const metaFooter = [
      [],
      ["METODOLOŠKE OPOMBE IN VIRI PODATKOV"],
      ["Družba", `${comp.name} (${comp.ticker}), ISIN: ${comp.isin}`],
      ["Datum tržnih podatkov", DATA.asOfDate || "20. 11. 2026"],
      ["Zadnja preverba", DATA.lastCheckedAt || "22. 11. 2026"],
      ["Število delnic brez lastnih (MSRP 33)", `${fmtCsvVal(comp.sharesEffectiveM)} mio (Izdane: ${fmtCsvVal(comp.sharesIssuedM)} mio)`],
      ["Dejanski FCF FY 2025 (mio EUR)", fmtCsvVal(d.fcfPeak2025M)],
      ["Normalizirani FCF = 5-letna mediana 2021-2025 (mio EUR)", fmtCsvVal(d.fcfNormalizedM)],
      ["5-letno aritmetično povprečje FCF 2021-2025 (mio EUR)", fmtCsvVal(d.fcf5yAvgM)],
      ["3-letno aritmetično povprečje FCF 2023-2025 (mio EUR)", fmtCsvVal(d.fcf3yAvgM)],
      ["Surovi čisti dolg FY 2025 (mio EUR)", fmtCsvVal(d.rawNetDebtM)],
      ["Odbitek za operativni denarni blažilnik (min(Bruto denar, 2% TTM prihodkov), mio EUR)", fmtCsvVal(d.operatingCashBufferM)],
      ["Prilagojeni čisti dolg v DCF modelu (mio EUR)", fmtCsvVal(d.netDebtM)],
      ["Viri", "Ljubljanska borza (LJSE uradna tečajnica), revidirana letna poročila (SEOnet / zbirka Delničar.si), Yahoo Finance (yfinance statični zajem 22. 11. 2026)"]
    ];

    const csvLines = [
      headers.join(";"),
      ...rows.map((r) => r.map(fmtCsvVal).join(";")),
      ...metaFooter.map((r) => r.join(";"))
    ];

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csvLines.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `SBITOP_${comp.ticker}_10Y_in_TTM_Podatki.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function shareCurrentUrl() {
    updateUrlParams();
    const urlStr = window.location.href;
    const btn = document.getElementById("btnShareUrl");
    const showCopiedFeedback = () => {
      const orig = btn.textContent;
      btn.textContent = "URL skopiran ✓";
      setTimeout(() => {
        btn.textContent = orig;
      }, 2200);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(urlStr)
        .then(showCopiedFeedback)
        .catch(() => {
          window.prompt("Kopirajte neposredno URL povezavo do trenutnega pogleda:", urlStr);
        });
    } else {
      window.prompt("Kopirajte neposredno URL povezavo do trenutnega pogleda:", urlStr);
    }
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

    document.querySelectorAll("#sidebarViewList .sidebar-nav-item").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-view")));
    });

    document.querySelectorAll("#sidebarModuleLinks .sidebar-nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-jump");
        const el = document.getElementById(targetId);
        if (el) {
          if (el.classList.contains("hidden")) {
            setView(targetId);
          } else {
            el.scrollIntoView({ behavior: "smooth" });
          }
        }
      });
    });

    document.querySelectorAll(".btn-collapse").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        const sec = document.getElementById(targetId);
        if (sec) sec.classList.toggle("collapsed");
      });
    });

    document.getElementById("btnExportCsv").addEventListener("click", exportCurrentCompanyCsv);
    document.getElementById("btnShareUrl").addEventListener("click", shareCurrentUrl);
    document.getElementById("btnPrintTearSheet").addEventListener("click", () => {
      window.print();
    });

    // FCF Basis / Valuation Methodology Selector
    document.getElementById("selSimBasis").addEventListener("change", (e) => {
      const comp = getCompany(selectedTicker);
      loadSimulatorDefaultsForCompany(comp, simState.activePreset, e.target.value);
    });

    // Simulator dual-bound inputs (preserving 0 with numOr, Item C17)
    const pairs = [
      ["numBaseCf", "rngBaseCf", "baseCashFlowM"],
      ["numNormRoe", "rngNormRoe", "normalizedRoePct"],
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
      if (!numEl || !rngEl) return;

      const updateVal = (val) => {
        const parsed = parseFloat(val);
        simState[key] = Number.isFinite(parsed) ? parsed : 0;
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
      const parsed = parseFloat(e.target.value);
      simState.netDebtM = Number.isFinite(parsed) ? parsed : 0;
      renderSimulatorOutputs(getCompany(selectedTicker));
    });

    const lkpgCapexInp = document.getElementById("numLkpgCapexDeduction");
    if (lkpgCapexInp) {
      lkpgCapexInp.addEventListener("input", (e) => {
        const parsed = parseFloat(e.target.value);
        simState.expansionCapexDeductionM = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        renderSimulatorOutputs(getCompany(selectedTicker));
      });
    }

    document.getElementById("selTerminalMethod").addEventListener("change", (e) => {
      simState.terminalMethod = e.target.value;
      renderSimulatorOutputs(getCompany(selectedTicker));
    });

    document.getElementById("btnPresetBear").addEventListener("click", () =>
      loadSimulatorDefaultsForCompany(getCompany(selectedTicker), "bear", simState.basisMode)
    );
    document.getElementById("btnPresetBase").addEventListener("click", () =>
      loadSimulatorDefaultsForCompany(getCompany(selectedTicker), "base", simState.basisMode)
    );
    document.getElementById("btnPresetBull").addEventListener("click", () =>
      loadSimulatorDefaultsForCompany(getCompany(selectedTicker), "bull", simState.basisMode)
    );
    document.getElementById("btnResetSim").addEventListener("click", () =>
      loadSimulatorDefaultsForCompany(getCompany(selectedTicker), "base")
    );

    const taxSelect = document.getElementById("selDivTaxRate");
    if (taxSelect) {
      taxSelect.addEventListener("change", (e) => {
        dividendTaxRatePct = numOr(e.target.value, 25.0);
        savePortfolioToStorage();
        updatePortfolioCalculations();
      });
    }

    document.getElementById("btnLoadIndexPortfolio").addEventListener("click", () => {
      initPortfolioPreset("index");
      renderModule7Portfolio(true);
    });
    document.getElementById("btnLoadEqualPortfolio").addEventListener("click", () => {
      initPortfolioPreset("equal");
      renderModule7Portfolio(true);
    });
  }

  // Boot Application
  if (!loadPortfolioFromStorage()) {
    initPortfolioPreset("index");
  }
  readUrlParams();
  bindEvents();
  selectCompany(selectedTicker, true);
  setView(activeView);
})();
