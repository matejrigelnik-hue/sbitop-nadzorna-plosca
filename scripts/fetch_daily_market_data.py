#!/usr/bin/env python3
"""
Avtomatski dnevni zajem tržnih tečajev za SBI TOP Nadzorno Ploščo:
1. Za vseh 9 družb v SBI TOP (brez EQNX) osveži dnevno serijo zaključnih tečajev (daily_points)
   z Ljubljanske borze (prek Delničar.si / LJSE tečajnice) v data/raw/companies_raw.json.
2. Prek knjižnice yfinance osveži trenutni tečaj indeksa DAX 40 (^GDAXI) in kazalnike vrednotenj
   za vseh 68 tujih primerljivih podjetij v data/raw/peers_yfinance.json.
3. Če kateri koli posamezen mrežni klic odpove, ohrani zadnje veljavne podatke iz data/raw/,
   tako da dnevna osvežitev nikoli ne pokvari podatkovne baze.
"""

import datetime
import json
import os
import re
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_COMPANIES_PATH = os.path.join(REPO_ROOT, "data", "raw", "companies_raw.json")
RAW_PEERS_PATH = os.path.join(REPO_ROOT, "data", "raw", "peers_yfinance.json")

TICKER_SLUGS = {
    "KRKG": "krkg",
    "NLBR": "nlbr",
    "PETG": "petg",
    "ZVTG": "zvtg",
    "LKPG": "lkpg",
    "POSR": "posr",
    "TLSG": "tlsg",
    "SALR": "salr",
    "CICG": "cicg"
}


def fetch_ljse_daily_points_for_slug(slug):
    """Fetches the latest 1Y daily closing price series for an LJSE stock."""
    url = f"https://xn--delniar-n6a.si/stock/{slug}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) SBI-TOP-Dashboard-Updater/1.0"
        }
    )
    html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", errors="ignore")
    pushes = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html)
    full = ""
    for p in pushes:
        try:
            full += json.loads(p)
        except Exception:
            pass

    daily_points = []
    for m in re.finditer(r'"points":\[', full):
        try:
            arr, _ = json.JSONDecoder().raw_decode(full[m.start() + len('"points":'):])
            if arr and isinstance(arr[0], dict) and "date" in arr[0] and "close" in arr[0]:
                daily_points = arr
        except Exception:
            pass
    return daily_points


def update_ljse_companies_raw():
    if not os.path.exists(RAW_COMPANIES_PATH):
        print(f"Manjka {RAW_COMPANIES_PATH}, preskakujem.")
        return

    with open(RAW_COMPANIES_PATH, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    updated_count = 0
    for ticker, slug in TICKER_SLUGS.items():
        if ticker not in raw_data:
            continue
        try:
            pts = fetch_ljse_daily_points_for_slug(slug)
            if pts and len(pts) >= 50:
                latest_pt = pts[-1]
                raw_data[ticker]["daily_points"] = pts
                updated_count += 1
                print(f"[LJSE] {ticker}: osveženih {len(pts)} dnevnih tečajev (zadnji: {latest_pt['date']} = {latest_pt['close']} €)")
            else:
                print(f"[LJSE] {ticker}: prazen odgovor, ohranjam obstoječo serijo.")
        except Exception as e:
            print(f"[LJSE] {ticker}: napaka pri prenosu ({e}), ohranjam obstoječo serijo.")

    if updated_count > 0:
        with open(RAW_COMPANIES_PATH, "w", encoding="utf-8") as f:
            json.dump(raw_data, f, ensure_ascii=False, separators=(",", ":"))
        print(f"Uspešno posodobljen {RAW_COMPANIES_PATH} ({updated_count}/9 družb).")


def update_yfinance_peers():
    try:
        import yfinance as yf
    except ImportError:
        print("Knjižnica yfinance ni nameščena, ohranjam obstoječi peers_yfinance.json.")
        return

    if not os.path.exists(RAW_PEERS_PATH):
        return

    with open(RAW_PEERS_PATH, "r", encoding="utf-8") as f:
        peers_data = json.load(f)

    today_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")

    # 1. Refresh DAX 40 (^GDAXI) latest close
    try:
        dax_hist = yf.Ticker("^GDAXI").history(period="10d")
        if not dax_hist.empty:
            latest_dax = round(float(dax_hist["Close"].iloc[-1]), 2)
            peers_data.setdefault("dax", {})["2026_latest"] = latest_dax
            peers_data["dax"]["asOf"] = today_iso
            print(f"[DAX] ^GDAXI posodobljen na {latest_dax} ({today_iso})")
    except Exception as e:
        print(f"[DAX] Napaka pri osvežitvi ^GDAXI: {e}")

    # 2. Refresh FX rates to EUR
    fx_to_eur = {"EUR": 1.0}
    for ccy, pair in [("USD", "EURUSD=X"), ("GBP", "EURGBP=X"), ("CHF", "EURCHF=X"), ("PLN", "EURPLN=X"), ("HUF", "EURHUF=X"), ("RON", "EURRON=X"), ("HKD", "EURHKD=X"), ("DKK", "EURDKK=X"), ("FIN", "EUR=X")]:
        try:
            h = yf.Ticker(pair).history(period="5d")
            if not h.empty:
                rate = float(h["Close"].iloc[-1])
                if rate > 0:
                    fx_to_eur[ccy] = 1.0 / rate
        except Exception:
            pass
    fx_to_eur["GBp"] = fx_to_eur.get("GBP", 1.18) / 100.0

    # 3. Refresh peer multiples
    peers_groups = peers_data.get("peers", {})
    refreshed_peers = 0
    for sbi_ticker, peer_list in peers_groups.items():
        for p in peer_list:
            pticker = p["ticker"]
            try:
                info = yf.Ticker(pticker).info
                if not info:
                    continue
                ccy = info.get("currency", "EUR")
                mcap_raw = info.get("marketCap")
                if mcap_raw:
                    mult = fx_to_eur.get(ccy, 1.0)
                    p["marketCapEurBn"] = round((float(mcap_raw) * mult) / 1e9, 2)

                t_pe = info.get("trailingPE")
                p["pe"] = round(float(t_pe), 2) if (t_pe and 0 < float(t_pe) < 120) else None

                f_pe = info.get("forwardPE")
                if f_pe and 0 < float(f_pe) < 120:
                    p["forwardPe"] = round(float(f_pe), 2)

                pb = info.get("priceToBook")
                if pb and 0 < float(pb) < 80:
                    p["pb"] = round(float(pb), 2)

                ev_eb = info.get("enterpriseToEbitda")
                if ev_eb and 0 < float(ev_eb) < 80 and sbi_ticker not in ("NLBR", "ZVTG", "POSR"):
                    p["evEbitda"] = round(float(ev_eb), 2)

                ps = info.get("priceToSalesTrailing12Months")
                if ps and 0 < float(ps) < 50:
                    p["ps"] = round(float(ps), 2)

                roe = info.get("returnOnEquity")
                if roe is not None and -1.0 < float(roe) < 1.5:
                    p["roePct"] = round(float(roe) * 100.0, 1)

                p["asOf"] = today_iso
                refreshed_peers += 1
            except Exception as e:
                print(f"[PEER] {pticker}: napaka ({e}), ohranjam zadnjo vrednost.")

    peers_data["fetchedAt"] = today_iso
    with open(RAW_PEERS_PATH, "w", encoding="utf-8") as f:
        json.dump(peers_data, f, indent=2, ensure_ascii=False)
    print(f"Uspešno posodobljenih {refreshed_peers} tujih vrstnikov v {RAW_PEERS_PATH}.")


if __name__ == "__main__":
    update_ljse_companies_raw()
    update_yfinance_peers()
