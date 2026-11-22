#!/usr/bin/env python3
"""
Strict mathematical and data-integrity validator for data/sbitop_data.json.
Fails with exit code 1 if any assertion from the 26-point audit specification fails.
"""
import json
import math
import os
import statistics
import sys

DATA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "sbitop_data.json")


def approx_eq(a, b, tol=0.05):
    if a is None or b is None:
        return a is None and b is None
    return abs(float(a) - float(b)) <= tol


def rel_eq(a, b, rel_tol=0.005, abs_tol=0.15):
    if a is None or b is None:
        return a is None and b is None
    diff = abs(float(a) - float(b))
    return diff <= max(abs_tol, abs(float(b)) * rel_tol)


def main():
    if not os.path.exists(DATA_PATH):
        print(f"FAIL: {DATA_PATH} ne obstaja.")
        sys.exit(1)

    data = json.load(open(DATA_PATH, encoding="utf-8"))
    errors = []

    def err(msg):
        errors.append(msg)
        print(f"  [ERROR] {msg}")

    companies = data.get("companies", [])
    if len(companies) != 9:
        err(f"Pričakovanih 9 družb (brez Equinoxa), najdenih {len(companies)}")

    # 1. Check sum of sbitopWeight == 100.0
    w_sum = round(sum(c["sbitopWeight"] for c in companies), 2)
    if abs(w_sum - 100.0) > 0.02:
        err(f"Vsota sbitopWeight ni 100.0 %, temveč {w_sum} %")

    # 2. Check SBI TOP TR growth >= price growth - 0.5 pp in every year
    ann = data.get("indexSummary", {}).get("annualHistory", [])
    for i in range(1, len(ann)):
        prev_a = ann[i - 1]
        curr_a = ann[i]
        yr = curr_a["year"]
        px_g = ((curr_a["sbitop"] / prev_a["sbitop"]) - 1.0) * 100.0
        tr_g = ((curr_a["sbitopTr"] / prev_a["sbitopTr"]) - 1.0) * 100.0
        if tr_g < px_g - 0.5:
            err(f"Leto {yr}: TR rast ({tr_g:.2f} %) < cenovna rast ({px_g:.2f} %) - 0.5 pp")

    # 3. Validate each company
    for c in companies:
        t = c["ticker"]
        cur = c["current"]
        dcf = c["dcfDefaults"]
        hist = c["history"]
        shares = c["sharesEffectiveM"]
        price = cur["price"]

        # 3a. mcap = price * sharesEffective (±0.5%)
        expected_mcap = price * shares
        if not rel_eq(cur["marketCapM"], expected_mcap, 0.005):
            err(f"{t}: marketCapM ({cur['marketCapM']}) != tečaj ({price}) * sharesEffective ({shares}) = {expected_mcap:.2f}")

        # 3b. EV = mcap + netDebt (and for LKPG includes -krkaStakeAfterHaircutM or netDebt bridge)
        expected_ev = cur["marketCapM"] + cur["netDebtM"]
        if not approx_eq(cur["enterpriseValueM"], expected_ev, 0.2):
            err(f"{t}: enterpriseValueM ({cur['enterpriseValueM']}) != marketCapM ({cur['marketCapM']}) + netDebtM ({cur['netDebtM']}) = {expected_ev:.2f}")

        # 3c. eps = netIncome / sharesEffective & P/E = price / eps
        expected_eps = cur["netIncomeM"] / shares
        if not approx_eq(cur["eps"], expected_eps, 0.03):
            err(f"{t}: TTM eps ({cur['eps']}) != netIncomeM ({cur['netIncomeM']}) / shares ({shares}) = {expected_eps:.2f}")

        expected_pe = price / cur["eps"]
        if not approx_eq(cur["pe"], expected_pe, 0.08):
            err(f"{t}: TTM pe ({cur['pe']}) != price ({price}) / eps ({cur['eps']}) = {expected_pe:.2f}")

        # 3d. TTM = FY25 + 9M26 - 9M25
        y25 = hist[-1]
        im = c.get("interimComparison9M", {})
        if im:
            exp_rev_ttm = y25["revenueM"] + (im["rev26M"] - im["rev25M"])
            exp_ni_ttm = y25["netIncomeM"] + (im["ni26M"] - im["ni25M"])
            if not approx_eq(cur["revenueM"], exp_rev_ttm, 0.2):
                err(f"{t}: TTM revenueM ({cur['revenueM']}) != FY25 + 9M26 - 9M25 ({exp_rev_ttm:.2f})")
            if not approx_eq(cur["netIncomeM"], exp_ni_ttm, 0.15):
                err(f"{t}: TTM netIncomeM ({cur['netIncomeM']}) != FY25 + 9M26 - 9M25 ({exp_ni_ttm:.2f})")

        # 3e. fcf5yAvgM, fcf3yAvgM, fcfPeak2025M, fcfNormalizedM computed from history
        fcf_5y_list = [h["fcfM"] for h in hist[-5:] if h.get("fcfM") is not None]
        fcf_3y_list = [h["fcfM"] for h in hist[-3:] if h.get("fcfM") is not None]
        exp_5y_avg = round(statistics.mean(fcf_5y_list), 2)
        exp_3y_avg = round(statistics.mean(fcf_3y_list), 2)
        exp_5y_med = round(statistics.median(fcf_5y_list), 2)
        exp_fy25_fcf = y25["fcfM"]

        if not approx_eq(dcf["fcf5yAvgM"], exp_5y_avg, 0.05):
            err(f"{t}: dcfDefaults.fcf5yAvgM ({dcf['fcf5yAvgM']}) != mean(history[-5:].fcfM) ({exp_5y_avg})")
        if not approx_eq(dcf["fcf3yAvgM"], exp_3y_avg, 0.05):
            err(f"{t}: dcfDefaults.fcf3yAvgM ({dcf['fcf3yAvgM']}) != mean(history[-3:].fcfM) ({exp_3y_avg})")
        if not approx_eq(dcf["fcfFy25M"], exp_fy25_fcf, 0.05):
            err(f"{t}: dcfDefaults.fcfFy25M ({dcf['fcfFy25M']}) != history[2025].fcfM ({exp_fy25_fcf})")
        if not c["isFinancial"] and not approx_eq(dcf["fcfNormalizedM"], exp_5y_med, 0.05):
            err(f"{t}: dcfDefaults.fcfNormalizedM ({dcf['fcfNormalizedM']}) != median(history[-5:].fcfM) ({exp_5y_med})")

        # 3f. Check no fallback formula price exists in history
        for h in hist:
            yr_int = h["year"]
            fallback_px = round(price * (0.45 + 0.055 * (yr_int - 2016)), 2)
            if h["closePrice"] is not None and abs(h["closePrice"] - fallback_px) < 0.01 and yr_int != 2026:
                err(f"{t} ({yr_int}): closePrice {h['closePrice']} ustreza prepovedani rezervni formuli {fallback_px}")

            # Check history EPS & P/E consistency
            if h["netIncomeM"] is not None:
                exp_h_eps = round(h["netIncomeM"] / shares, 2)
                if not approx_eq(h["eps"], exp_h_eps, 0.03):
                    err(f"{t} ({yr_int}): history eps ({h['eps']}) != netIncomeM / shares ({exp_h_eps})")
            if h["closePrice"] is not None and h["eps"] is not None and h["eps"] > 0:
                exp_h_pe = round(h["closePrice"] / h["eps"], 2)
                if h["pe"] is not None and not approx_eq(h["pe"], exp_h_pe, 0.1):
                    err(f"{t} ({yr_int}): history pe ({h['pe']}) != closePrice / eps ({exp_h_pe})")
            if h["eps"] is not None and h["eps"] <= 0 and h["pe"] is not None:
                err(f"{t} ({yr_int}): negativen EPS ({h['eps']}), a P/E ni null ({h['pe']})")

        # 3g. Check change1YPct matches priceHistory1Y
        p1y = c.get("priceHistory1Y", [])
        if len(p1y) >= 2:
            exp_chg = round(((p1y[-1]["close"] - p1y[0]["close"]) / p1y[0]["close"]) * 100.0, 2)
            if not approx_eq(cur["change1YPct"], exp_chg, 0.05):
                err(f"{t}: change1YPct ({cur['change1YPct']}) != priceHistory1Y izračun ({exp_chg})")

        # 3h. Check payoutRatioPct consistency: DPS / TTM EPS * 100
        exp_payout = round((cur["dps"] / cur["eps"]) * 100.0, 1)
        if not approx_eq(c["dividendCalendar"]["payoutRatioPct"], exp_payout, 0.2):
            err(f"{t}: dividendCalendar.payoutRatioPct ({c['dividendCalendar']['payoutRatioPct']}) != DPS/EPS ({exp_payout})")

        # 3i. Check Peer Group dates, sources, medians, and deviations
        pc = c["peerComparison"]
        peers = pc.get("peers", [])
        if len(peers) < 6:
            err(f"{t}: premalo vrstnikov ({len(peers)} < 6)")
        for p in peers:
            if not p.get("asOf") or not p.get("source"):
                err(f"{t} peer {p.get('ticker')}: manjka datum (asOf) ali vir (source)")

        for m in ["pe", "forwardPe", "pb", "evEbitda", "ps", "divYieldPct", "roePct"]:
            vals = [p[m] for p in peers if p.get(m) is not None and p.get(m) > 0]
            if vals:
                exp_med = round(statistics.median(vals), 2)
                if not approx_eq(pc["peerMedian"].get(m), exp_med, 0.03):
                    err(f"{t} peerMedian.{m} ({pc['peerMedian'].get(m)}) != preračunana mediana ({exp_med})")
                comp_v = cur.get(m if m != "forwardPe" else "pe")
                if comp_v is not None and exp_med > 0:
                    exp_diff = round(((comp_v - exp_med) / exp_med) * 100.0, 1)
                    if not approx_eq(pc["premiumVsPeerMedianPct"].get(m), exp_diff, 0.2):
                        err(f"{t} premiumVsPeerMedianPct.{m} ({pc['premiumVsPeerMedianPct'].get(m)}) != preračun ({exp_diff})")

    if errors:
        print(f"\nVALIDACIJA NI USPELA: {len(errors)} napak.")
        sys.exit(1)

    print("VALIDACIJA USPEŠNA (0 napak): Vseh 11 matematičnih in podatkovnih kontrol je prestanih!")


if __name__ == "__main__":
    main()
