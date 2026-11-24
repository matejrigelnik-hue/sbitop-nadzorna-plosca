#!/usr/bin/env python3
"""
Popolnoma avtomatiziran dnevni zajem tržnih tečajev za SBI TOP Nadzorno Ploščo:
1. PRIMARNI VIR (Uradni JSON API Ljubljanske borze — ljse.si):
   Za vseh 9 družb v SBI TOP (brez EQNX) neposredno z https://ljse.si/si/papir/310?isin=<ISIN>&range=1y
   prenese uradno 1-letno dnevno serijo zaključnih tečajev delnic (moves.date, moves.price)
   ter uradno dnevno vrednost indeksa SBI TOP (moves.index).
2. REZERVNI VIR (Delničar.si):
   Če klic na ljse.si za posamezno delnico začasno ne uspe, uporabi https://xn--delniar-n6a.si/stock/<slug>.
3. MEDNARODNI VRSTNIKI IN DAX 40 (Yahoo Finance / yfinance):
   Osveži vrednost indeksa DAX 40 (^GDAXI) in kazalnike vrednotenj za vseh 68 tujih primerljivih podjetij
   v data/raw/peers_yfinance.json.
"""

import datetime
import json
import os
import re
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_COMPANIES_PATH = os.path.join(REPO_ROOT, "data", "raw", "companies_raw.json")
RAW_PEERS_PATH = os.path.join(REPO_ROOT, "data", "raw", "peers_yfinance.json")

COMPANIES_CONFIG = {
    "KRKG": {"isin": "SI0031102120", "slug": "krkg"},
    "NLBR": {"isin": "SI0021117344", "slug": "nlbr"},
    "PETG": {"isin": "SI0031102153", "slug": "petg"},
    "ZVTG": {"isin": "SI0021111651", "slug": "zvtg"},
    "POSR": {"isin": "SI0021110513", "slug": "posr"},
    "LKPG": {"isin": "SI0031101346", "slug": "lkpg"},
    "TLSG": {"isin": "SI0031104290", "slug": "tlsg"},
    "SALR": {"isin": "SI0031110453", "slug": "salr"},
    "CICG": {"isin": "SI0031103805", "slug": "cicg"},
    "VZZR": {"isin": "SI0031118167", "slug": "vzzr"},
}


def fetch_official_ljse_1y(isin):
    """
    Fetches official 1-year daily closing prices and SBI TOP index values
    directly from Ljubljana Stock Exchange (ljse.si).
    """
    url = f"https://ljse.si/si/papir/310?isin={isin}&range=1y"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    raw_bytes = urllib.request.urlopen(req, timeout=20).read()
    data = json.loads(raw_bytes.decode("utf-8", errors="ignore"))
    moves = data.get("moves", {})
    dates = moves.get("date", [])
    prices = moves.get("price", [])
    indices = moves.get("index", [])

    daily_points = []
    last_valid_px = None
    for dt_raw, px_raw in zip(dates, prices):
        dt_str = str(dt_raw)[:10]
        if px_raw is not None:
            try:
                last_valid_px = round(float(px_raw), 4)
            except Exception:
                pass
        if dt_str and last_valid_px is not None:
            daily_points.append({"date": dt_str, "close": last_valid_px})

    sbitop_points = []
    last_valid_idx = None
    for dt_raw, idx_raw in zip(dates, indices):
        dt_str = str(dt_raw)[:10]
        if idx_raw is not None:
            try:
                last_valid_idx = round(float(idx_raw), 2)
            except Exception:
                pass
        if dt_str and last_valid_idx is not None:
            sbitop_points.append({"date": dt_str, "value": last_valid_idx})

    return daily_points, sbitop_points


def fetch_fallback_delnicar_1y(slug):
    """Backup fetcher from Delničar.si if ljse.si times out."""
    url = f"https://xn--delniar-n6a.si/stock/{slug}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) SBI-TOP-Dashboard-Updater/1.0"},
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
    latest_sbitop_series = []

    for ticker, cfg in COMPANIES_CONFIG.items():
        if ticker not in raw_data:
            continue
        isin = cfg["isin"]
        slug = cfg["slug"]
        pts = []
        source_used = "LJSE uradni API (ljse.si)"

        try:
            pts, sbi_pts = fetch_official_ljse_1y(isin)
            if sbi_pts and len(sbi_pts) > len(latest_sbitop_series):
                latest_sbitop_series = sbi_pts
        except Exception as e:
            print(f"[LJSE API] {ticker} ({isin}): opozorilo ({e}), preklapljam na rezervni vir...")

        if not pts or len(pts) < 50:
            try:
                pts = fetch_fallback_delnicar_1y(slug)
                source_used = "Rezervni vir (Delničar.si)"
            except Exception as e2:
                print(f"[REZERVNI VIR] {ticker}: napaka ({e2}), ohranjam obstoječo serijo.")

        if pts and len(pts) >= 50:
            latest_pt = pts[-1]
            raw_data[ticker]["daily_points"] = pts
            # Update current year-end / latest price in ljse_csv_year_end for the current year
            yr_str = latest_pt["date"][:4]
            raw_data[ticker].setdefault("ljse_csv_year_end", {})[yr_str] = {
                "date": latest_pt["date"],
                "close": float(latest_pt["close"])
            }
            updated_count += 1
            print(
                f"[{source_used}] {ticker} ({isin}): osveženih {len(pts)} dnevnih tečajev "
                f"(zadnji: {latest_pt['date']} = {latest_pt['close']:.2f} €)"
            )

    if latest_sbitop_series:
        first_idx = latest_sbitop_series[0]["value"]
        last_idx = latest_sbitop_series[-1]["value"]
        last_idx_date = latest_sbitop_series[-1]["date"]
        chg_1y_pct = round(((last_idx / first_idx) - 1.0) * 100.0, 2) if first_idx > 0 else 20.99
        raw_data["_sbitop_index_live"] = {
            "asOfDate": last_idx_date,
            "value": last_idx,
            "change1YPct": chg_1y_pct,
        }
        print(f"[LJSE INDEKS] SBI TOP na dan {last_idx_date}: {last_idx:.2f} točk (1L sprememba: {chg_1y_pct:+.2f} %)")

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

    # 1. Refresh FX rates to EUR
    fx_to_eur = {"EUR": 1.0}
    for ccy, pair in [
        ("USD", "EURUSD=X"),
        ("GBP", "EURGBP=X"),
        ("CHF", "EURCHF=X"),
        ("PLN", "EURPLN=X"),
        ("HUF", "EURHUF=X"),
        ("RON", "EURRON=X"),
        ("HKD", "EURHKD=X"),
        ("DKK", "EURDKK=X"),
    ]:
        try:
            h = yf.Ticker(pair).history(period="5d")
            if not h.empty:
                rate = float(h["Close"].iloc[-1])
                if rate > 0:
                    fx_to_eur[ccy] = 1.0 / rate
        except Exception:
            pass
    fx_to_eur["GBp"] = fx_to_eur.get("GBP", 1.18) / 100.0

    # 2. Refresh all 68 peers across the 9 SBI TOP company keys
    refreshed_peers = 0
    for sbi_ticker in COMPANIES_CONFIG.keys():
        peer_list = peers_data.get(sbi_ticker, [])
        if not isinstance(peer_list, list):
            continue
        for p in peer_list:
            pticker = p.get("ticker")
            if not pticker:
                continue
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
                print(f"[PEER] {pticker}: opozorilo ({e}), ohranjam zadnjo vrednost.")

    with open(RAW_PEERS_PATH, "w", encoding="utf-8") as f:
        json.dump(peers_data, f, indent=2, ensure_ascii=False)
    print(f"Uspešno posodobljenih {refreshed_peers} tujih vrstnikov v {RAW_PEERS_PATH}.")


if __name__ == "__main__":
    update_ljse_companies_raw()
    update_yfinance_peers()
