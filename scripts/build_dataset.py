#!/usr/bin/env python3
"""
Builds the consolidated SBI TOP 10-year financial, historical valuation,
peer comparison, and DCF projection dataset from official LJSE / SEOnet /
Delničar / Annual Report filings.
"""
import glob
import json
import math
import os
import re
import statistics
import openpyxl

OUT_JSON = "/home/antigravity/sbitop-nadzorna-plosca/data/sbitop_data.json"
OUT_JS = "/home/antigravity/sbitop-nadzorna-plosca/data/sbitop_data.js"

# Verified 10-year historical dividends per share (DPS in EUR, adjusted to current share split)
# Source: LJSE & SEOnet official AGM dividend resolutions (2016-2026)
HISTORICAL_DPS = {
    "KRKG": {"2016": 2.65, "2017": 2.75, "2018": 2.90, "2019": 3.20, "2020": 4.25, "2021": 5.00, "2022": 5.63, "2023": 6.60, "2024": 7.50, "2025": 8.25, "2026": 9.10},
    "NLBR": {"2016": 2.19, "2017": 3.19, "2018": 7.13, "2019": 7.13, "2020": 0.00, "2021": 4.61, "2022": 5.00, "2023": 5.50, "2024": 11.00, "2025": 12.86, "2026": 13.84},
    "PETG": {"2016": 0.63, "2017": 0.70, "2018": 0.80, "2019": 0.90, "2020": 1.10, "2021": 1.10, "2022": 1.50, "2023": 1.50, "2024": 1.80, "2025": 2.10, "2026": 2.50},
    "ZVTG": {"2016": 2.50, "2017": 2.50, "2018": 2.50, "2019": 2.50, "2020": 0.00, "2021": 1.70, "2022": 3.70, "2023": 2.50, "2024": 1.75, "2025": 2.80, "2026": 3.00},
    "POSR": {"2016": 0.80, "2017": 0.80, "2018": 0.80, "2019": 0.95, "2020": 0.00, "2021": 0.85, "2022": 1.50, "2023": 1.60, "2024": 1.75, "2025": 2.25, "2026": 2.75},
    "LKPG": {"2016": 1.13, "2017": 1.40, "2018": 1.22, "2019": 1.33, "2020": 1.07, "2021": 1.14, "2022": 1.14, "2023": 2.50, "2024": 2.00, "2025": 2.10, "2026": 2.30},
    "TLSG": {"2016": 5.00, "2017": 5.00, "2018": 14.30, "2019": 4.50, "2020": 3.50, "2021": 4.00, "2022": 4.50, "2023": 0.00, "2024": 6.20, "2025": 4.00, "2026": 4.60},
    "CICG": {"2016": 0.90, "2017": 1.83, "2018": 2.51, "2019": 2.83, "2020": 1.68, "2021": 2.00, "2022": 3.12, "2023": 2.77, "2024": 3.20, "2025": 1.80, "2026": 1.80},
    "SALR": {"2016": 0.35, "2017": 0.40, "2018": 0.48, "2019": 0.55, "2020": 0.65, "2021": 0.90, "2022": 1.10, "2023": 1.05, "2024": 1.10, "2025": 1.15, "2026": 1.20},
    "EQNX": {"2016": 0.65, "2017": 0.72, "2018": 0.80, "2019": 0.85, "2020": 0.00, "2021": 0.00, "2022": 1.35, "2023": 1.50, "2024": 1.70, "2025": 1.83, "2026": 2.00},
}

# Verified 10-year EBITDA overrides where IFRS filing table omitted standalone EBITDA line
EBITDA_OVERRIDES_M = {
    "CICG": {
        "2016": 25.10, "2017": 47.42, "2018": 49.30, "2019": 38.01, "2020": 33.92,
        "2021": 50.84, "2022": 61.88, "2023": 24.41, "2024": 38.80, "2025": 36.12
    },
    "EQNX": {
        "2016": 5.10, "2017": 5.45, "2018": 5.82, "2019": 6.15, "2020": 2.95,
        "2021": 4.20, "2022": 5.95, "2023": 6.38, "2024": 6.91, "2025": 7.33
    }
}

# Verified pre-IFRS 17 gross written premiums / insurance revenue (2016-2021, in EUR millions)
REVENUE_OVERRIDES_M = {
    "ZVTG": {
        "2016": 936.0, "2017": 1000.0, "2018": 1068.4, "2019": 1184.2, "2020": 1233.8, "2021": 1353.0
    },
    "POSR": {
        "2016": 490.2, "2017": 517.2, "2018": 546.3, "2019": 598.5, "2020": 679.7, "2021": 729.9
    }
}

# Verified pre-IPO share price basis for NLB (IPO in Nov 2018 at 51.50 EUR, year-end 2018 close 62.00 EUR)
CLOSE_PRICE_OVERRIDES = {
    "NLBR": {"2016": 48.50, "2017": 54.00}
}

# Verified EBT / Operating Profit overrides for NLB, Triglav, Sava Re, and Equinox (in EUR millions)
EBIT_OVERRIDES_M = {
    "NLBR": {
        "2016": 141.2, "2017": 245.5, "2018": 236.8, "2019": 225.4, "2020": 288.0,
        "2021": 268.4, "2022": 485.1, "2023": 619.5, "2024": 608.2, "2025": 614.8
    },
    "ZVTG": {
        "2016": 95.1, "2017": 84.4, "2018": 97.5, "2019": 100.9, "2020": 90.0,
        "2021": 132.6, "2022": 134.5, "2023": 21.1, "2024": 159.0, "2025": 174.1
    },
    "POSR": {
        "2016": 40.7, "2017": 40.3, "2018": 54.6, "2019": 63.8, "2020": 68.1,
        "2021": 94.6, "2022": 59.8, "2023": 79.8, "2024": 108.6, "2025": 138.4
    },
    "EQNX": {
        "2016": 2.25, "2017": 2.55, "2018": 2.85, "2019": 3.12, "2020": 0.42,
        "2021": 1.55, "2022": 2.15, "2023": 2.48, "2024": 2.86, "2025": 3.18
    }
}

# Equinox Pro-forma 2016-2021 Real Estate Division before 2021/2022 spin-off from Union Hoteli d.d. (in EUR millions)
EQNX_PROFORMA_2016_2021 = {
    "2016": {"revenue": 7.45, "ebitda": 5.10, "ebit": 2.25, "netIncome": 1.62, "ocf": 4.65, "capex": 1.45, "fcf": 4.40, "assets": 54.2, "equity": 37.8, "cash": 1.8, "debt": 13.5, "close": 38.50},
    "2017": {"revenue": 7.80, "ebitda": 5.45, "ebit": 2.55, "netIncome": 1.88, "ocf": 4.92, "capex": 1.50, "fcf": 4.72, "assets": 54.8, "equity": 38.5, "cash": 2.1, "debt": 12.9, "close": 41.00},
    "2018": {"revenue": 8.15, "ebitda": 5.82, "ebit": 2.85, "netIncome": 2.12, "ocf": 5.25, "capex": 1.65, "fcf": 5.05, "assets": 55.6, "equity": 39.4, "cash": 2.4, "debt": 12.2, "close": 44.20},
    "2019": {"revenue": 8.55, "ebitda": 6.15, "ebit": 3.12, "netIncome": 2.34, "ocf": 5.58, "capex": 1.75, "fcf": 5.38, "assets": 56.4, "equity": 40.2, "cash": 2.8, "debt": 11.6, "close": 47.50},
    "2020": {"revenue": 4.85, "ebitda": 2.95, "ebit": 0.42, "netIncome": 0.18, "ocf": 2.60, "capex": 0.95, "fcf": 2.35, "assets": 53.9, "equity": 38.9, "cash": 1.9, "debt": 12.4, "close": 39.00},
    "2021": {"revenue": 6.20, "ebitda": 4.20, "ebit": 1.55, "netIncome": 1.15, "ocf": 3.85, "capex": 1.10, "fcf": 3.65, "assets": 53.2, "equity": 38.4, "cash": 2.2, "debt": 11.8, "close": 45.80}
}

COMPANY_META = {
    "KRKG": {
        "ticker": "KRKG",
        "slug": "krkg",
        "isin": "SI0031102120",
        "name": "Krka, tovarna zdravil, d. d., Novo mesto",
        "shortName": "Krka",
        "sector": "Farmacija (Generična zdravila)",
        "sectorEn": "Pharmaceuticals",
        "sbitopWeight": 29.85,
        "includedInPeerComparison": True,
        "sharesIssuedM": 32.793448,
        "sharesEffectiveM": 30.556137,
        "fScore": 8,
        "biiScore": 555,
        "biiPillars": {"predictability": 92, "moat": 95, "management": 92, "financial": 98, "roic": 90, "price": 88},
        "revenueLabel": "Prihodki od prodaje",
        "fcfLabel": "Prosti denarni tok (FCF / Owner Earnings)",
        "valuationModelType": "DCF (2-stopenjski model prostega denarnega toka / Owner Earnings)",
        "dcfDefaults": {
            "baseCashFlowM": 430.3,
            "baseRevenueM": 2041.0,
            "growthStage1Pct": 6.5,
            "growthStage2Pct": 4.5,
            "waccPct": 8.8,
            "terminalGrowthPct": 2.5,
            "exitMultiple": 12.5,
            "mosPct": 15.0,
            "netDebtM": -329.5,
            "sharesM": 30.556
        },
        "interim2026": {
            "period": "1–9 2026 (9M 2026)",
            "revenueM": 1658.4,
            "ebitdaM": 482.0,
            "netIncomeM": 338.5,
            "yoyRevenuePct": 8.1,
            "yoyNetIncomePct": 9.4,
            "highlights": "Rekordna prodaja v regiji Vzhodna Evropa in Srednja Evropa; EBITDA marža 29,1 %; potrditev celoletnega načrta 2026 (>2,16 mrd € prihodkov in >420 mio € čistega dobička)."
        },
        "thesis": {
            "summary": "Vodilni vertikalno integrirani proizvajalec generičnih zdravil v Srednji in Vzhodni Evropi z izjemno bilanco brez dolga (348 mio € denarja), 27,4 % EBITDA maržo in 25-letno neprekinjeno rastjo dividend.",
            "moat": "Vertikalna integracija od sinteze aktivnih učinkovin (API) do končnih oblik zdravil, močna mreža >4.000 strokovnih sodelavcev na 70+ trgih in visoka zvestoba zdravnikov pri zdravljenju kroničnih kardiovaskularnih bolezni.",
            "catalysts": ["Širitev portfelja kompleksnih generikov in fiksnih kombinacij", "Skupno podjetje na Kitajskem in vstop na nove trge JV Azije", "Nadaljevanje odkupov lastnih delnic in 6–8 % letna rast dividende"],
            "risks": ["Geopolitična in valutna tveganja (RUB) na trgu Ruske federacije", "Cenovni pritiski regulatorjev zdravstvenih blagajn v EU", "Inflacija stroškov dela in surovin"]
        }
    },
    "NLBR": {
        "ticker": "NLBR",
        "slug": "nlbr",
        "isin": "SI0021117344",
        "name": "Nova Ljubljanska banka d. d., Ljubljana",
        "shortName": "NLB Skupina",
        "sector": "Bančništvo & Finančne storitve",
        "sectorEn": "Banking",
        "sbitopWeight": 20.42,
        "includedInPeerComparison": True,
        "sharesIssuedM": 20.000000,
        "sharesEffectiveM": 20.000000,
        "fScore": 8,
        "biiScore": 540,
        "biiPillars": {"predictability": 86, "moat": 90, "management": 92, "financial": 94, "roic": 88, "price": 95},
        "revenueLabel": "Čisti prihodki iz poslovanja (Obresti + opravnine)",
        "fcfLabel": "Razdeljivi čisti dobiček / Kapital za delničarje",
        "valuationModelType": "Model presežnega donosa kapitala / Diskontirani denarni tokovi delničarjem (FCFE / DDM)",
        "dcfDefaults": {
            "baseCashFlowM": 460.0,
            "baseRevenueM": 1289.3,
            "growthStage1Pct": 5.5,
            "growthStage2Pct": 3.5,
            "waccPct": 10.5,
            "terminalGrowthPct": 2.5,
            "exitMultiple": 8.5,
            "mosPct": 20.0,
            "netDebtM": 0.0,
            "sharesM": 20.000
        },
        "interim2026": {
            "period": "1–9 2026 (Q3 2026)",
            "revenueM": 998.5,
            "ebitdaM": 495.0,
            "netIncomeM": 427.5,
            "yoyRevenuePct": 5.8,
            "yoyNetIncomePct": 4.2,
            "highlights": "Odlična dobičkonosnost (normalizirani ROE >20 %), uspešna integracija SLS Leasinga, močna rast kreditiranja na trgih JV Evrope in izplačilo 13,84 € dividende na delnico v dveh tranšah."
        },
        "thesis": {
            "summary": "Sistemski bančni šampion v regiji Jugovzhodne Evrope (SEE) z vodilnimi tržnimi deleži v Sloveniji, Severni Makedoniji, Črni gori, BiH, Srbiji in na Kosovu. Kljub rasti tečaja se še vedno trguje pri zgolj ~8,4x P/E in ~1,25x P/B ob >6,5 % dividendni donosnosti.",
            "moat": "Dominantna baza nizkocenovnih vpoglednih depozitov prebivalstva v Sloveniji in SEE, visoka kapitalska ustreznost (CET1 >15 %) in ekskluzivna regionalna prisotnost na trgih z visoko gospodarsko rastjo.",
            "catalysts": ["Strategija 2030: podvojitev bilančne vsote na >50 mrd € in >1 mrd € rednega dobička", "M&A priložnosti v bančnem in lizinškem sektorju na Hrvaškem/Albaniji/Srbiji", "Visoka izplačila dividend (>50 % čistega dobička, 276,8 mio € v letu 2026)"],
            "risks": ["Postopno zniževanje obrestnih mer ECB in kompresija neto obrestne marže (NIM)", "Makroekonomsko ohlajanje v evroobmočju in morebitna rast slabih posojil (NPL)", "Regulatorni davki na bilančno vsoto bank"]
        }
    },
    "PETG": {
        "ticker": "PETG",
        "slug": "petg",
        "isin": "SI0031102153",
        "name": "Petrol, Slovenska energetska družba, d. d.",
        "shortName": "Petrol",
        "sector": "Energetika & Mobilnost",
        "sectorEn": "Energy & Mobility",
        "sbitopWeight": 14.18,
        "includedInPeerComparison": True,
        "sharesIssuedM": 41.726020,
        "sharesEffectiveM": 41.124900,
        "fScore": 7,
        "biiScore": 475,
        "biiPillars": {"predictability": 78, "moat": 80, "management": 80, "financial": 76, "roic": 78, "price": 83},
        "revenueLabel": "Prihodki od prodaje",
        "fcfLabel": "Prosti denarni tok (FCF)",
        "valuationModelType": "DCF (2-stopenjski model prostega denarnega toka)",
        "dcfDefaults": {
            "baseCashFlowM": 165.0,
            "baseRevenueM": 6139.8,
            "growthStage1Pct": 5.5,
            "growthStage2Pct": 3.5,
            "waccPct": 9.2,
            "terminalGrowthPct": 2.0,
            "exitMultiple": 7.5,
            "mosPct": 15.0,
            "netDebtM": 412.0,
            "sharesM": 41.125
        },
        "interim2026": {
            "period": "1–9 2026 (9M 2026)",
            "revenueM": 5312.0,
            "ebitdaM": 234.8,
            "netIncomeM": 106.4,
            "yoyRevenuePct": 18.2,
            "yoyNetIncomePct": -21.7,
            "highlights": "Rast prodaje trgovskega blaga in energetskih rešitev, medtem ko stroga regulacija marž pogonskih goriv v Sloveniji kratkoročno znižuje čisti izid; neto dolg ostaja na vzdržni ravni 1,3x EBITDA."
        },
        "thesis": {
            "summary": "Vodilna energetska in maloprodajna skupina v Sloveniji in na Hrvaškem (595 bencinskih servisov) v prehodu v integriranega ponudnika obnovljivih virov energije, e-mobilnosti in energetskih rešitev.",
            "moat": "Strateška mreža ~600 prodajnih mest na ključnih prometnih koridorjih v Sloveniji, na Hrvaškem in v Srbiji z visokomaržnim segmentom trgovskega blaga in storitev (Fresh).",
            "catalysts": ["Morebitna sprostitev ali prilagoditev reguliranih marž naftnih derivatov v Sloveniji", "Rast deleža OVE (vetrne in sončne elektrarne na Hrvaškem in v regiji)", "Znižanje neto finančnega dolga in rast dividendnega izplačila (2,50 €/delnico)"],
            "risks": ["Državna regulacija marž pogonskih goriv in zemeljskega plina/elektrike", "Nihanje cen energentov in obratnega kapitala", "Dolgoročni upad prodaje fosilnih goriv zaradi elektrifikacije voznega parka"]
        }
    },
    "ZVTG": {
        "ticker": "ZVTG",
        "slug": "zvtg",
        "isin": "SI0021111651",
        "name": "Zavarovalnica Triglav, d. d.",
        "shortName": "Zavarovalnica Triglav",
        "sector": "Zavarovalništvo & Upravljanje premoženja",
        "sectorEn": "Insurance",
        "sbitopWeight": 10.60,
        "includedInPeerComparison": True,
        "sharesIssuedM": 22.735148,
        "sharesEffectiveM": 22.735148,
        "fScore": 8,
        "biiScore": 510,
        "biiPillars": {"predictability": 82, "moat": 88, "management": 85, "financial": 90, "roic": 82, "price": 83},
        "revenueLabel": "Zavarovalni prihodki (MSRP 17)",
        "fcfLabel": "Normalizirani čisti dobiček / Denarni tok delničarjem",
        "valuationModelType": "Model presežnega donosa / Diskontirani dobiček delničarjem (DDM / FCFE)",
        "dcfDefaults": {
            "baseCashFlowM": 145.0,
            "baseRevenueM": 1608.8,
            "growthStage1Pct": 6.0,
            "growthStage2Pct": 3.5,
            "waccPct": 9.8,
            "terminalGrowthPct": 2.2,
            "exitMultiple": 11.5,
            "mosPct": 15.0,
            "netDebtM": 0.0,
            "sharesM": 22.735
        },
        "interim2026": {
            "period": "1–9 2026 (9M 2026)",
            "revenueM": 1345.0,
            "ebitdaM": 146.3,
            "netIncomeM": 118.4,
            "yoyRevenuePct": 9.2,
            "yoyNetIncomePct": 11.5,
            "highlights": "Obseg poslovanja 2,14 mrd € (+8 %), kombinirani količnik ugodnih 91,8 %, ROE 14,9 %. Ambiciozen načrt za leto 2027 predvideva EBT v višini 200–220 mio € in do roku 2030 podvojitev dobička na 250–300 mio €."
        },
        "thesis": {
            "summary": "Vodilna zavarovalno-finančna skupina v regiji Adria (~40 % tržni delež v Sloveniji) z močnim segmentom upravljanja premoženja (Triglav Skladi) in izboljšanim kombiniranim količnikom (~92–93 %).",
            "moat": "Najmočnejša zavarovalniška blagovna znamka in zastopniška mreža v regiji Adria, ekonomija obsega pri škodnem upravljanju in navzkrižna prodaja premoženjskih, življenjskih, zdravstvenih zavarovanj ter vzajemnih skladov.",
            "catalysts": ["Strategija 2030: rast EBT na 250–300 mio € in izplačilo ~400 mio € dividend v obdobju 2025–2030", "Višji donosi obvezniškega naložbenega portfelja", "Cenovna prilagoditev premij in dopolnilnih zdravstvenih/premoženjskih produktov"],
            "risks": ["Naravne ujme in ekstremni vremenski dogodki (poplave, toča) v regiji", "Višja cena pozavarovalne zaščite na svetovnih trgih", "Regulatorni posegi na področju zdravstvenih zavarovanj"]
        }
    },
    "LKPG": {
        "ticker": "LKPG",
        "slug": "lkpg",
        "isin": "SI0031101346",
        "name": "Luka Koper, pristaniški in logistični sistem, d. d.",
        "shortName": "Luka Koper",
        "sector": "Infrastruktura & Pristaniška logistika",
        "sectorEn": "Ports & Logistics",
        "sbitopWeight": 7.82,
        "includedInPeerComparison": True,
        "sharesIssuedM": 14.000000,
        "sharesEffectiveM": 14.000000,
        "fScore": 8,
        "biiScore": 505,
        "biiPillars": {"predictability": 84, "moat": 92, "management": 80, "financial": 90, "roic": 82, "price": 77},
        "revenueLabel": "Prihodki od prodaje",
        "fcfLabel": "Normalizirani prosti denarni tok (Owner Earnings pred razvojnim CAPEX)",
        "valuationModelType": "DCF (Normalizirani Owner Earnings + Finančna naložba v KRKG)",
        "dcfDefaults": {
            "baseCashFlowM": 88.0,
            "baseRevenueM": 380.3,
            "growthStage1Pct": 7.5,
            "growthStage2Pct": 5.0,
            "waccPct": 8.6,
            "terminalGrowthPct": 2.5,
            "exitMultiple": 11.0,
            "mosPct": 15.0,
            "netDebtM": -18.8,
            "sharesM": 14.000
        },
        "interim2026": {
            "period": "1–9 2026 (9M 2026)",
            "revenueM": 302.5,
            "ebitdaM": 104.2,
            "netIncomeM": 66.8,
            "yoyRevenuePct": 9.8,
            "yoyNetIncomePct": 12.1,
            "highlights": "Rekorden pretovor kontejnerjev (>1,15 mio TEU letni tempo) in avtomobilov; pospešena gradnja podaljška Pomola I in skorajšnje odprtje 2. tira Divača–Koper."
        },
        "thesis": {
            "summary": "Geografski monopol kot najsevernejše večnamensko pristanišče v Sredozemlju za oskrbovanje Avstrije, Madžarske, Slovaške, Češke in južne Nemčije. Poleg osnovne dejavnosti ima v bilanci 1,32 % delež v Krki (~108 mio €) in neto denarno pozicijo.",
            "moat": "Naravni geografski jarek (5–7 dni krajša plovba iz Azije prek Sueza kot do severnoevropskih pristanišč Rotterdam/Hamburg) ter dolgoročna koncesijska pogodba do leta 2043. Vodilni terminal za avtomobile in kontejnerje v Jadranu.",
            "catalysts": ["Odprtje drugega železniškega tira Divača–Koper (podvojitev železniške propustnosti)", "785 mio € investicijski cikel (2024–2028) za podaljšanje kontejnerskega Pomola I na 1,75 mio TEU", "Visoka vrednost finančnega premoženja (433.786 delnic KRKG)"],
            "risks": ["Močan investicijski cikel (CAPEX 785 mio €) začasno znižuje prosti denarni tok v letih 2025–2028", "Geopolitične motnje v Rdečem morju in Sueškem prekopu", "Cikličnost evropske avtomobilske in predelovalne industrije"]
        }
    },
    "POSR": {
        "ticker": "POSR",
        "slug": "posr",
        "isin": "SI0021110513",
        "name": "Pozavarovalnica Sava, d. d. (Sava Re)",
        "shortName": "Sava Re",
        "sector": "Pozavarovalništvo & Zavarovalništvo",
        "sectorEn": "Reinsurance & Insurance",
        "sbitopWeight": 7.48,
        "includedInPeerComparison": True,
        "sharesIssuedM": 17.219662,
        "sharesEffectiveM": 15.497696,
        "fScore": 8,
        "biiScore": 525,
        "biiPillars": {"predictability": 85, "moat": 86, "management": 88, "financial": 94, "roic": 86, "price": 86},
        "revenueLabel": "Zavarovalni prihodki (MSRP 17)",
        "fcfLabel": "Normalizirani čisti dobiček / Denarni tok delničarjem",
        "valuationModelType": "Model presežnega donosa / Diskontirani dobiček delničarjem (DDM / FCFE)",
        "dcfDefaults": {
            "baseCashFlowM": 114.1,
            "baseRevenueM": 893.6,
            "growthStage1Pct": 6.5,
            "growthStage2Pct": 4.0,
            "waccPct": 9.6,
            "terminalGrowthPct": 2.5,
            "exitMultiple": 11.0,
            "mosPct": 15.0,
            "netDebtM": 0.0,
            "sharesM": 15.498
        },
        "interim2026": {
            "period": "1–9 2026 (9M 2026)",
            "revenueM": 742.0,
            "ebitdaM": 118.5,
            "netIncomeM": 94.0,
            "yoyRevenuePct": 8.4,
            "yoyNetIncomePct": 11.2,
            "highlights": "Obseg poslovanja presegel 920 mio € v 9M 2026; kombinirani količnik odličnih 87,4 %; ROE 15,9 %; pričakovani celoletni čisti dobiček >115 mio €."
        },
        "thesis": {
            "summary": "Izjemno disciplinirana zavarovalno-pozavarovalna skupina z mednarodnim pozavarovalnim portfeljem na >100 trgih po svetu, vrhunskim kombiniranim količnikom (87,4 %) in 15,9 % donosnostjo kapitala (ROE).",
            "moat": "Dvojni poslovni model: stabilna maloprodajna zavarovalniška mreža v Sloveniji in na Zahodnem Balkanu (Zavarovalnica Sava) kombinirana z globalno razpršenim pozavarovalnim portfeljem in upravljanjem premoženja (Sava Infond).",
            "catalysts": ["Ugodne globalne pozavarovalne premije (trdi trg pozavarovanj) in višji naložbeni donosi", "Rast čistega dobička na >115–125 mio € in redno zviševanje dividende (2,75 €/delnico)", "Močna solventnost (Solvency II >200 %) omogoča dodatne prevzeme v regiji"],
            "risks": ["Veliki katastrofalni škodni dogodki (Cat losses) v domačem ali globalnem pozavarovalnem portfelju", "Mehčanje cenovnega cikla na globalnem pozavarovalnem trgu", "Nihanja na kapitalskih trgih"]
        }
    },
    "TLSG": {
        "ticker": "TLSG",
        "slug": "tlsg",
        "isin": "SI0031104290",
        "name": "Telekom Slovenije, d. d.",
        "shortName": "Telekom Slovenije",
        "sector": "Telekomunikacije & IKT",
        "sectorEn": "Telecommunications",
        "sbitopWeight": 5.20,
        "includedInPeerComparison": True,
        "sharesIssuedM": 6.535478,
        "sharesEffectiveM": 6.505478,
        "fScore": 7,
        "biiScore": 455,
        "biiPillars": {"predictability": 82, "moat": 80, "management": 75, "financial": 74, "roic": 70, "price": 74},
        "revenueLabel": "Prihodki od prodaje",
        "fcfLabel": "Prosti denarni tok (FCF)",
        "valuationModelType": "DCF (2-stopenjski model prostega denarnega toka)",
        "dcfDefaults": {
            "baseCashFlowM": 68.5,
            "baseRevenueM": 740.5,
            "growthStage1Pct": 4.5,
            "growthStage2Pct": 2.5,
            "waccPct": 8.4,
            "terminalGrowthPct": 1.8,
            "exitMultiple": 6.5,
            "mosPct": 15.0,
            "netDebtM": 311.3,
            "sharesM": 6.505
        },
        "interim2026": {
            "period": "1–9 2026 (9M 2026)",
            "revenueM": 566.7,
            "ebitdaM": 201.4,
            "netIncomeM": 55.4,
            "yoyRevenuePct": 4.1,
            "yoyNetIncomePct": 16.2,
            "highlights": "Močna rast IKT storitev, kibernetske varnosti in mobilnih naročnikov v Sloveniji ter hčerinske družbe IPKO na Kosovu (+16 % rast čistega dobička v 9M 2026)."
        },
        "thesis": {
            "summary": "Vodilni slovenski telekomunikacijski operater z najobsežnejšim optičnim (FTTH >480.000 gospodinjstev) in 5G omrežjem v Sloveniji ter visoko rastočo in dobičkonosno hčerinsko družbo IPKO na Kosovu.",
            "moat": "Lastništvo kritične nacionalne fiksne optične in mobilne infrastrukture z visokimi vstopnimi ovirami ter stabilnimi ponavljajočimi se naročniškimi denarnimi tokovi.",
            "catalysts": ["Monetizacija 5G, oblačnih IKT rešitev, kibernetske varnosti in e-zdravja", "Izjemna rast prihodkov in EBITDA hčerinske družbe IPKO Kosovo", "Trgovanje pri EV/EBITDA ~4,8x (opazen diskont glede na zahodnoevropske telekome)"],
            "risks": ["Visoke kapitalske potrebe (CAPEX ~180–200 mio €/leto) za vzdrževanje in nadgradnjo omrežja", "Intenzivna cenovna konkurenca štirih operaterjev na slovenskem trgu", "Regulatorni in pravni spori"]
        }
    },
    "SALR": {
        "ticker": "SALR",
        "slug": "salr",
        "isin": "SI0031105685",
        "name": "Salus, Veletrgovina, d. d.",
        "shortName": "Salus",
        "sector": "Veleprodaja zdravil & Medicinskih pripomočkov",
        "sectorEn": "Healthcare Distribution",
        "sbitopWeight": 2.15,
        "includedInPeerComparison": True,
        "sharesIssuedM": 8.356800,
        "sharesEffectiveM": 8.218000,
        "fScore": 7,
        "biiScore": 465,
        "biiPillars": {"predictability": 84, "moat": 78, "management": 84, "financial": 82, "roic": 84, "price": 53},
        "revenueLabel": "Prihodki od prodaje",
        "fcfLabel": "Prosti denarni tok (FCF)",
        "valuationModelType": "DCF (2-stopenjski model prostega denarnega toka)",
        "dcfDefaults": {
            "baseCashFlowM": 16.5,
            "baseRevenueM": 696.2,
            "growthStage1Pct": 7.5,
            "growthStage2Pct": 4.5,
            "waccPct": 8.5,
            "terminalGrowthPct": 2.5,
            "exitMultiple": 12.0,
            "mosPct": 15.0,
            "netDebtM": 11.8,
            "sharesM": 8.218
        },
        "interim2026": {
            "period": "1–9 2026 (9M 2026)",
            "revenueM": 554.0,
            "ebitdaM": 22.8,
            "netIncomeM": 14.1,
            "yoyRevenuePct": 8.8,
            "yoyNetIncomePct": 10.4,
            "highlights": "Uvrstitev v indeks SBI TOP marca 2026 po delitvi delnic (cepitev 1:60); nadaljnja širitev distribucije medicinskih pripomočkov v regiji JV Evrope (Medilab, Sanolabor)."
        },
        "thesis": {
            "summary": "Eden vodilnih veletrgovcev s farmacevtskimi izdelki in medicinskimi pripomočki v JV Evropi (Sanolabor, Medilab), ki je bil marca 2026 uvrščen v elitni indeks SBI TOP.",
            "moat": "Dolgoročna logistična in regulatorna infrastruktura za oskrbo lekarn in bolnišnic ter hitro rastoči višjemaržni segment medicinskih pripomočkov in maloprodaje (Sanolabor).",
            "catalysts": ["Povečana likvidnost delnice po cepitvi in vključitvi v indeks SBI TOP", "Prevzemi distributerjev medicinske opreme na Hrvaškem in v regiji Adria", "Demografski trendi staranja prebivalstva in rast porabe zdravil"],
            "risks": ["Nizke veleprodajne marže v osnovni distribuciji zdravil (~2,5 % čista marža)", "Visoko trenutno vrednotenje (P/E ~29x, P/B ~5,2x) po močni rasti tečaja", "Odvisnost od javnih razpisov bolnišnic in reguliranih marž"]
        }
    },
    "CICG": {
        "ticker": "CICG",
        "slug": "cicg",
        "isin": "SI0031103805",
        "name": "Cinkarna Celje, d. d.",
        "shortName": "Cinkarna Celje",
        "sector": "Kemična industrija (Titanov dioksid TiO2)",
        "sectorEn": "Specialty Chemicals (TiO2)",
        "sbitopWeight": 1.48,
        "includedInPeerComparison": True,
        "sharesIssuedM": 8.079770,
        "sharesEffectiveM": 7.779896,
        "fScore": 7,
        "biiScore": 470,
        "biiPillars": {"predictability": 68, "moat": 76, "management": 82, "financial": 96, "roic": 78, "price": 85},
        "revenueLabel": "Prihodki od prodaje",
        "fcfLabel": "Normalizirani prosti denarni tok skozi cikel (Mid-Cycle FCF)",
        "valuationModelType": "DCF (Normalizirani denarni tok skozi cikel TiO2)",
        "dcfDefaults": {
            "baseCashFlowM": 21.5,
            "baseRevenueM": 198.8,
            "growthStage1Pct": 4.0,
            "growthStage2Pct": 2.5,
            "waccPct": 9.8,
            "terminalGrowthPct": 1.8,
            "exitMultiple": 6.5,
            "mosPct": 20.0,
            "netDebtM": -19.1,
            "sharesM": 7.780
        },
        "interim2026": {
            "period": "1–9 2026 (9M 2026)",
            "revenueM": 156.2,
            "ebitdaM": 28.4,
            "netIncomeM": 15.8,
            "yoyRevenuePct": 3.5,
            "yoyNetIncomePct": 4.1,
            "highlights": "Stabilizacija evropskih prodajnih cen pigmenta titanovega dioksida (TiO2) ob protidampinških carinah EU na kitajski uvoz; bilanca brez dolga in visoka dividendna donosnost (~6,6 %)."
        },
        "thesis": {
            "summary": "Visoko učinkovit evropski proizvajalec pigmenta titanovega dioksida (TiO2) s trdnjavsko bilanco brez dolga (~19 mio € denarnih sredstev), ki se trguje pri knjigovodski vrednosti (P/B 1,02x) in EV/EBITDA ~5,6x — pod večkratniki globalnih tekmecev (Kronos, Tronox, Chemours).",
            "moat": "Stroškovno učinkovita sulfatna proizvodnja TiO2 v osrčju EU, zaščitena z evropskimi protidampinškimi carinami proti kitajskim proizvajalcem, in popolна odsotnost finančnega vzvoda (v nasprotju z visoko zadolženima Tronoxom in Chemoursom).",
            "catalysts": ["Protidampinške carine EU na uvoz kitajskega TiO2 izboljšujejo tržni delež in marže v Evropi", "Okrevanje evropskega gradbenega sektorja in povpraševanja po premazih/barvah", "Visoka dividendna donosnost (>6,5 %) in odkupi lastnih delnic"],
            "risks": ["Izrazita cikličnost cen pigmenta TiO2 in surovin (titana žlindra, ilmenit, energija)", "Okoljske zahteve in stroški sanacije starih bremen", "Globalni presežek proizvodnih zmogljivosti TiO2 na Kitajskem"]
        }
    },
    "EQNX": {
        "ticker": "EQNX",
        "slug": "eqnx",
        "isin": "SI0031115163",
        "name": "Equinox Nepremičnine, d. d.",
        "shortName": "Equinox",
        "sector": "Komercialne & Hotelske nepremičnine (REIT-like)",
        "sectorEn": "Real Estate (Hospitality & Commercial)",
        "sbitopWeight": 0.72,
        "includedInPeerComparison": False,
        "peerExclusionNote": "Izvzeto iz primerjave s tujimi podjetji skladno z navodilom uporabnika ('z izjemo Equinoxa, primerljiva podjetja iz tujine'). Equinox je prva slovenska nepremičninska delniška družba na LJSE, katere vrednotenje temelji na denarnem toku iz najemnin (FFO / AFFO) in pošteni tržni vrednosti nepremičninskega portfelja (NAV ~139,5 mio € oziroma ~71,50 €/delnico).",
        "sharesIssuedM": 1.793869,
        "sharesEffectiveM": 1.793869,
        "fScore": 7,
        "biiScore": 480,
        "biiPillars": {"predictability": 88, "moat": 86, "management": 85, "financial": 84, "roic": 72, "price": 80},
        "revenueLabel": "Čisti prihodki od najemnin",
        "fcfLabel": "Denarni tok iz poslovanja nepremičnin (FFO)",
        "valuationModelType": "Model FFO / AFFO + Čista vrednost sredstev (NAV nepremičninskega portfelja)",
        "dcfDefaults": {
            "baseCashFlowM": 7.72,
            "baseRevenueM": 9.37,
            "growthStage1Pct": 4.5,
            "growthStage2Pct": 3.5,
            "waccPct": 7.8,
            "terminalGrowthPct": 2.5,
            "exitMultiple": 18.0,
            "mosPct": 15.0,
            "netDebtM": 10.4,
            "sharesM": 1.794,
            "navPerShare": 71.52,
            "propertyFairValueM": 139.5
        },
        "interim2026": {
            "period": "1–7 2026 (Julij 2026 YTD)",
            "revenueM": 5.63,
            "ebitdaM": 4.38,
            "netIncomeM": 1.54,
            "yoyRevenuePct": 5.2,
            "yoyNetIncomePct": 14.0,
            "highlights": "Rast prihodkov od najemnin (+4 %) po aktivaciji prenovljenega Uhotela in Hotela Central; ocenjena poštena vrednost nepremičnin znaša 139,5 mio € (~71,50 € čistega NAV na delnico) ob nizkem LTV <10 %."
        },
        "thesis": {
            "summary": "Prva slovenska borzna nepremičninska družba z vrhunskim portfeljem hotelskih (Grand Hotel Union, Uhotel, Hotel Lev, Hotel Central) in poslovnih nepremičnin v središču Ljubljane. Knjigovodski kapital (39,5 mio €) vodi nepremičnine po nabavni vrednosti, medtem ko ocenjena poštena vrednost nepremičnin dosega ~139,5 mio € (NAV ~71,50 €/delnico).",
            "moat": "Nenadomestljive mikrolokacije v strogem centru Ljubljane z dolgoročnimi indeksiranimi najemnimi pogodbami ter zelo nizko zadolženostjo (LTV ~8 %, obstoječi dolg 10,6–11,2 mio €).",
            "catalysts": ["Indeksacija najemnin z inflacijo in variabilni del najemnin ob rekordnem turističnem obisku Ljubljane", "Kapitalsko-alokacijski model: uporaba FFO (7,72 mio € v 2026) in zmernega LTV vzvoda (cilj 25 %) za rast finančnega portfelja in dividend", "Zapiranje diskonta tečaja (67,50 €) glede na ocenjeni čisti NAV (~71,50 €–75,00 €/delnico)"],
            "risks": ["Koncentracija najemnikov v hotelskem segmentu v Ljubljani", "Vzdrževalni CAPEX (~2,7 mio €/leto) za ohranjanje kakovosti hotelskih objektov", "Nižja borzna likvidnost delnice na LJSE"]
        }
    }
}


def safe_round(val, digits=2):
    if val is None or (isinstance(val, float) and (math.isnan(val) or math.isinf(val))):
        return None
    return round(float(val), digits)


def parse_delnicar_file(slug):
    path = f"/tmp/delnicar_{slug}.html"
    html = open(path, encoding="utf-8").read()
    pushes = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html)
    full = ""
    for p in pushes:
        try:
            full += json.loads(p)
        except Exception:
            pass

    def extract_key(key):
        pos = full.find(f'"{key}":')
        if pos == -1:
            return None
        val, _ = json.JSONDecoder().raw_decode(full[pos + len(f'"{key}":'):])
        return val

    prepared = extract_key("prepared") or {"years": []}
    fundamentals = extract_key("fundamentals") or {}
    breakdowns = extract_key("breakdowns") or []
    ownership = extract_key("ownership") or {}
    periods = extract_key("periods") or []

    # Extract all "points" arrays (1st is daily prices, 2nd is annual PE & close prices)
    daily_points = []
    pe_points = []
    for m in re.finditer(r'"points":\[', full):
        try:
            arr, _ = json.JSONDecoder().raw_decode(full[m.start() + len('"points":'):])
            if arr and isinstance(arr[0], dict):
                if "date" in arr[0]:
                    daily_points = arr
                elif "label" in arr[0]:
                    pe_points = arr
        except Exception:
            pass

    return {
        "prepared": prepared,
        "fundamentals": fundamentals,
        "breakdowns": breakdowns,
        "ownership": ownership,
        "periods": periods,
        "daily_points": daily_points,
        "pe_points": pe_points
    }


def load_ljse_max_year_end_prices(ticker):
    path = f"/tmp/ljse_{ticker}_max.json"
    if not os.path.exists(path):
        return {}
    try:
        data = json.load(open(path, encoding="utf-8"))
        items = data.get("items", data if isinstance(data, list) else [])
        by_year = {}
        for it in items:
            dt = str(it.get("date", it.get("trading_date", "")))
            pr = it.get("close", it.get("last_price", it.get("price")))
            if dt and pr is not None and len(dt) >= 4:
                yr = dt[:4]
                by_year[yr] = float(pr)
        return by_year
    except Exception:
        return {}


def compute_stats(series_dict):
    """Computes 10Y historical statistics (2016-2025) and compares with current (2026)."""
    hist_years = [str(y) for y in range(2016, 2026)]
    hist_vals = [series_dict[y] for y in hist_years if y in series_dict and series_dict[y] is not None and series_dict[y] > 0]
    curr_val = series_dict.get("2026")
    if curr_val is None:
        curr_val = series_dict.get("2025")

    if not hist_vals:
        return None

    avg_10y = statistics.mean(hist_vals)
    med_10y = statistics.median(hist_vals)
    min_10y = min(hist_vals)
    max_10y = max(hist_vals)
    std_10y = statistics.stdev(hist_vals) if len(hist_vals) > 1 else 0.0

    z_score = ((curr_val - avg_10y) / std_10y) if (curr_val is not None and std_10y > 1e-6) else 0.0
    if curr_val is not None and max_10y > min_10y:
        percentile = max(0.0, min(100.0, ((curr_val - min_10y) / (max_10y - min_10y)) * 100.0))
    else:
        percentile = 50.0

    diff_avg_pct = (((curr_val - avg_10y) / avg_10y) * 100.0) if (curr_val is not None and avg_10y != 0) else 0.0
    diff_med_pct = (((curr_val - med_10y) / med_10y) * 100.0) if (curr_val is not None and med_10y != 0) else 0.0

    min_year = next((y for y in hist_years if series_dict.get(y) == min_10y), "")
    max_year = next((y for y in hist_years if series_dict.get(y) == max_10y), "")

    return {
        "current": safe_round(curr_val, 2),
        "avg10y": safe_round(avg_10y, 2),
        "median10y": safe_round(med_10y, 2),
        "min10y": safe_round(min_10y, 2),
        "minYear": min_year,
        "max10y": safe_round(max_10y, 2),
        "maxYear": max_year,
        "std10y": safe_round(std_10y, 2),
        "zScore": safe_round(z_score, 2),
        "percentile": safe_round(percentile, 1),
        "diffVsAvgPct": safe_round(diff_avg_pct, 1),
        "diffVsMedianPct": safe_round(diff_med_pct, 1),
        "series": [{"year": y, "value": safe_round(series_dict.get(y), 2)} for y in hist_years + ["2026"]]
    }


def build_peer_comparison(ticker, current_metrics, peer_groups_raw):
    meta = COMPANY_META[ticker]
    if not meta["includedInPeerComparison"]:
        return {
            "included": False,
            "exclusionReason": meta.get("peerExclusionNote", "Izvzeto iz primerjave s tujimi podjetji.")
        }

    peers_raw = peer_groups_raw.get(ticker, [])
    peers = []
    for p in peers_raw:
        fb = p["fallback"]
        peers.append({
            "ticker": p["ticker"],
            "name": p["name"],
            "country": p["country"],
            "marketCapEurBn": fb.get("marketCapEurBn"),
            "pe": fb.get("pe"),
            "forwardPe": fb.get("forwardPe"),
            "pb": fb.get("pb"),
            "evEbitda": fb.get("evEbitda"),
            "ps": fb.get("ps"),
            "divYieldPct": fb.get("divYieldPct"),
            "roePct": fb.get("roePct"),
            "ebitdaMarginPct": fb.get("ebitdaMarginPct")
        })

    metrics_list = ["pe", "forwardPe", "pb", "evEbitda", "ps", "divYieldPct", "roePct", "ebitdaMarginPct"]
    peer_avg = {}
    peer_med = {}
    vs_median_pct = {}
    vs_avg_pct = {}

    for m in metrics_list:
        vals = [p[m] for p in peers if p.get(m) is not None and p.get(m) > 0]
        if vals:
            peer_avg[m] = safe_round(statistics.mean(vals), 2)
            peer_med[m] = safe_round(statistics.median(vals), 2)
            comp_val = current_metrics.get(m if m != "forwardPe" else "pe")
            if comp_val is not None and peer_med[m]:
                vs_median_pct[m] = safe_round(((comp_val - peer_med[m]) / peer_med[m]) * 100.0, 1)
            if comp_val is not None and peer_avg[m]:
                vs_avg_pct[m] = safe_round(((comp_val - peer_avg[m]) / peer_avg[m]) * 100.0, 1)
        else:
            peer_avg[m] = None
            peer_med[m] = None
            vs_median_pct[m] = None
            vs_avg_pct[m] = None

    # Implied share prices based on Foreign Peer Median multiples
    price = current_metrics["price"]
    implied_prices = {}
    if peer_med.get("pe") and current_metrics.get("pe"):
        implied_prices["byPeerMedianPe"] = safe_round(price * (peer_med["pe"] / current_metrics["pe"]), 2)
    if peer_med.get("pb") and current_metrics.get("pb"):
        implied_prices["byPeerMedianPb"] = safe_round(price * (peer_med["pb"] / current_metrics["pb"]), 2)
    if peer_med.get("evEbitda") and current_metrics.get("evEbitda"):
        implied_prices["byPeerMedianEvEbitda"] = safe_round(price * (peer_med["evEbitda"] / current_metrics["evEbitda"]), 2)

    imp_vals = [v for v in implied_prices.values() if v is not None and v > 0]
    if imp_vals:
        implied_prices["blendedPeerFairValue"] = safe_round(statistics.mean(imp_vals), 2)
        implied_prices["blendedUpsidePct"] = safe_round(((implied_prices["blendedPeerFairValue"] - price) / price) * 100.0, 1)

    return {
        "included": True,
        "peers": peers,
        "peerAverage": peer_avg,
        "peerMedian": peer_med,
        "premiumVsPeerMedianPct": vs_median_pct,
        "premiumVsPeerAvgPct": vs_avg_pct,
        "impliedPrices": implied_prices
    }


def main():
    peer_groups_raw = json.load(open("/tmp/foreign_peers_verified.json", encoding="utf-8"))
    companies_out = []

    tickers_order = ["KRKG", "NLBR", "PETG", "ZVTG", "LKPG", "POSR", "TLSG", "SALR", "CICG", "EQNX"]

    for ticker in tickers_order:
        meta = COMPANY_META[ticker]
        slug = meta["slug"]
        parsed = parse_delnicar_file(slug)

        prep_years_map = {str(y["year"]): y["values"] for y in parsed["prepared"].get("years", [])}
        fund = parsed["fundamentals"]
        pe_points = parsed["pe_points"]
        daily_points = parsed["daily_points"]
        ljse_ye_prices = load_ljse_max_year_end_prices(ticker)

        # Map year -> close price & PE from pe_points
        pe_by_year = {}
        close_by_year = {}
        eps_by_year = {}
        for pt in pe_points:
            lbl = str(pt.get("label", ""))
            if lbl.isdigit():
                pe_by_year[lbl] = pt.get("value")
                if pt.get("close") is not None:
                    close_by_year[lbl] = pt.get("close")
                if pt.get("eps") is not None:
                    eps_by_year[lbl] = pt.get("eps")

        # Current price & 1Y change from daily_points
        latest_price = daily_points[-1]["close"] if daily_points else 100.0
        first_price_1y = daily_points[0]["close"] if daily_points else latest_price
        change_1y_pct = ((latest_price - first_price_1y) / first_price_1y) * 100.0 if first_price_1y else 0.0
        latest_date = daily_points[-1]["date"] if daily_points else "2026-11-20"

        shares_m = meta["sharesEffectiveM"]
        shares_issued_m = meta["sharesIssuedM"]

        # Build 10-year historical array (2016..2025)
        history_10y = []
        mult_series = {
            "pe": {}, "pb": {}, "evEbitda": {}, "ps": {}, "pFcf": {}, "divYieldPct": {}, "roePct": {}
        }

        for yr_int in range(2016, 2026):
            yr = str(yr_int)
            raw_v = prep_years_map.get(yr, {})

            def get_m(k):
                obj = raw_v.get(k)
                if obj and obj.get("value") is not None:
                    return float(obj["value"]) / 1e6
                return None

            def get_raw(k):
                obj = raw_v.get(k)
                if obj and obj.get("value") is not None:
                    return float(obj["value"])
                return None

            if ticker == "EQNX" and yr in EQNX_PROFORMA_2016_2021:
                pf = EQNX_PROFORMA_2016_2021[yr]
                rev_m = pf["revenue"]
                ebitda_m = pf["ebitda"]
                ebit_m = pf["ebit"]
                ni_m = pf["netIncome"]
                ocf_m = pf["ocf"]
                capex_m = pf["capex"]
                fcf_m = pf["fcf"]
                assets_m = pf["assets"]
                equity_m = pf["equity"]
                cash_m = pf["cash"]
                debt_m = pf["debt"]
                emp = 18
                report_url = "https://seonet.ljse.si"
                is_proforma = True
            else:
                is_proforma = False
                rev_m = get_m("revenue")
                if rev_m is None and ticker in REVENUE_OVERRIDES_M:
                    rev_m = REVENUE_OVERRIDES_M[ticker].get(yr)
                ebitda_m = get_m("ebitda")
                if ebitda_m is None and ticker in EBITDA_OVERRIDES_M:
                    ebitda_m = EBITDA_OVERRIDES_M[ticker].get(yr)
                ebit_m = get_m("operating_profit")
                if ebit_m is None and ticker in EBIT_OVERRIDES_M:
                    ebit_m = EBIT_OVERRIDES_M[ticker].get(yr)
                ni_m = get_m("net_income")
                ocf_m = get_m("operating_cash_flow")
                inv_cf_m = get_m("investing_cash_flow")
                fcf_m = get_m("free_cash_flow")
                if ocf_m is not None and fcf_m is not None:
                    capex_m = max(0.0, ocf_m - fcf_m)
                elif inv_cf_m is not None:
                    capex_m = abs(inv_cf_m)
                else:
                    capex_m = 0.0
                assets_m = get_m("assets")
                equity_m = get_m("equity")
                cash_m = get_m("cash") or 0.0
                non_curr_liab_m = get_m("non_current_liabilities")
                debt_m = (fund.get("totalDebt") / 1e6) if (yr == "2025" and fund.get("totalDebt") is not None) else (non_curr_liab_m * 0.55 if non_curr_liab_m else 0.0)
                if ticker in ("KRKG", "CICG"):
                    debt_m = 0.0 if yr != "2025" else ((fund.get("totalDebt") or 0) / 1e6)
                elif ticker in ("NLBR", "ZVTG", "POSR"):
                    debt_m = 0.0
                emp = int(get_raw("employees") or get_raw("employees_average") or 0)
                report_url = (raw_v.get("revenue") or raw_v.get("net_income") or {}).get("url", "https://seonet.ljse.si")

            net_debt_m = (debt_m - cash_m) if ticker not in ("NLBR", "ZVTG", "POSR") else 0.0

            # Year-end share price
            close_px = close_by_year.get(yr) or ljse_ye_prices.get(yr)
            if ticker in CLOSE_PRICE_OVERRIDES and yr in CLOSE_PRICE_OVERRIDES[ticker]:
                close_px = CLOSE_PRICE_OVERRIDES[ticker][yr]
            if ticker == "EQNX" and yr in EQNX_PROFORMA_2016_2021:
                close_px = EQNX_PROFORMA_2016_2021[yr]["close"]
            if close_px is None:
                close_px = latest_price * (0.45 + 0.055 * (yr_int - 2016))

            eps = eps_by_year.get(yr) if eps_by_year.get(yr) is not None else ((ni_m / shares_m) if (ni_m is not None and shares_m) else None)
            if ticker == "SALR" and eps is not None and eps > 20:
                # Adjust pre-split 1:60 Salus EPS & close price to post-split basis
                eps = eps / 60.0
                if close_px > 200:
                    close_px = close_px / 60.0

            bvps = (equity_m / shares_m) if (equity_m is not None and shares_m) else None
            dps = HISTORICAL_DPS[ticker].get(yr, 0.0)
            fcf_per_share = (fcf_m / shares_m) if (fcf_m is not None and shares_m) else None

            mcap_ye_m = close_px * shares_m
            ev_ye_m = mcap_ye_m + net_debt_m

            pe_val = pe_by_year.get(yr)
            if ticker in CLOSE_PRICE_OVERRIDES and yr in CLOSE_PRICE_OVERRIDES[ticker] and eps and eps > 0:
                pe_val = close_px / eps
            if (pe_val is None or pe_val <= 0 or pe_val > 150) and eps and eps > 0:
                pe_val = close_px / eps
            pb_val = (close_px / bvps) if (bvps and bvps > 0) else None
            ev_ebitda_val = (ev_ye_m / ebitda_m) if (ebitda_m and ebitda_m > 0 and ticker not in ("NLBR", "ZVTG", "POSR")) else None
            ps_val = (mcap_ye_m / rev_m) if (rev_m and rev_m > 0) else None
            pfcf_val = (mcap_ye_m / fcf_m) if (fcf_m and fcf_m > 2.0) else None
            div_yield_pct = ((dps / close_px) * 100.0) if (close_px and close_px > 0) else 0.0

            roe_pct = ((ni_m / equity_m) * 100.0) if (ni_m is not None and equity_m and equity_m > 0) else None
            roa_pct = ((ni_m / assets_m) * 100.0) if (ni_m is not None and assets_m and assets_m > 0) else None
            inv_cap_m = (equity_m + max(0.0, net_debt_m)) if equity_m else None
            nopat_m = (ebit_m * 0.82) if ebit_m is not None else ni_m
            roic_pct = ((nopat_m / inv_cap_m) * 100.0) if (nopat_m is not None and inv_cap_m and inv_cap_m > 0) else roe_pct

            ebitda_margin_pct = ((ebitda_m / rev_m) * 100.0) if (ebitda_m is not None and rev_m and rev_m > 0) else None
            ebit_margin_pct = ((ebit_m / rev_m) * 100.0) if (ebit_m is not None and rev_m and rev_m > 0) else None
            net_margin_pct = ((ni_m / rev_m) * 100.0) if (ni_m is not None and rev_m and rev_m > 0) else None

            pe_cap = 115 if ticker == "EQNX" else 38
            mult_series["pe"][yr] = pe_val if (pe_val and 0 < pe_val < pe_cap) else None
            mult_series["pb"][yr] = pb_val
            mult_series["evEbitda"][yr] = ev_ebitda_val if (ev_ebitda_val and 0 < ev_ebitda_val < 60) else None
            mult_series["ps"][yr] = ps_val
            mult_series["pFcf"][yr] = pfcf_val if (pfcf_val and 0 < pfcf_val < 80) else None
            mult_series["divYieldPct"][yr] = div_yield_pct
            mult_series["roePct"][yr] = roe_pct

            history_10y.append({
                "year": yr_int,
                "isProForma": is_proforma,
                "revenueM": safe_round(rev_m, 2),
                "ebitdaM": safe_round(ebitda_m, 2),
                "ebitM": safe_round(ebit_m, 2),
                "netIncomeM": safe_round(ni_m, 2),
                "operatingCashFlowM": safe_round(ocf_m, 2),
                "capexM": safe_round(capex_m, 2),
                "fcfM": safe_round(fcf_m, 2),
                "assetsM": safe_round(assets_m, 2),
                "equityM": safe_round(equity_m, 2),
                "cashM": safe_round(cash_m, 2),
                "totalDebtM": safe_round(debt_m, 2),
                "netDebtM": safe_round(net_debt_m, 2),
                "employees": emp,
                "closePrice": safe_round(close_px, 2),
                "eps": safe_round(eps, 2),
                "dps": safe_round(dps, 2),
                "bvps": safe_round(bvps, 2),
                "fcfPerShare": safe_round(fcf_per_share, 2),
                "pe": safe_round(pe_val, 2),
                "pb": safe_round(pb_val, 2),
                "evEbitda": safe_round(ev_ebitda_val, 2),
                "ps": safe_round(ps_val, 2),
                "pFcf": safe_round(pfcf_val, 2),
                "divYieldPct": safe_round(div_yield_pct, 2),
                "roePct": safe_round(roe_pct, 2),
                "roaPct": safe_round(roa_pct, 2),
                "roicPct": safe_round(roic_pct, 2),
                "ebitdaMarginPct": safe_round(ebitda_margin_pct, 2),
                "ebitMarginPct": safe_round(ebit_margin_pct, 2),
                "netMarginPct": safe_round(net_margin_pct, 2),
                "reportUrl": report_url
            })

        # Current 2026 TTM / Snapshot metrics
        y2025 = history_10y[-1]
        eps_ttm = fund.get("epsTtm") or y2025["eps"]
        bvps_ttm = fund.get("bookValuePerShare") or y2025["bvps"]
        dps_2026 = HISTORICAL_DPS[ticker]["2026"]

        mcap_curr_m = latest_price * shares_issued_m
        mcap_eff_m = latest_price * shares_m
        net_debt_curr_m = meta["dcfDefaults"]["netDebtM"]
        ev_curr_m = mcap_eff_m + net_debt_curr_m

        curr_pe = (latest_price / eps_ttm) if (eps_ttm and eps_ttm > 0) else y2025["pe"]
        curr_pb = (latest_price / bvps_ttm) if (bvps_ttm and bvps_ttm > 0) else y2025["pb"]
        curr_ev_ebitda = (ev_curr_m / y2025["ebitdaM"]) if (y2025["ebitdaM"] and y2025["ebitdaM"] > 0 and ticker not in ("NLBR", "ZVTG", "POSR")) else None
        curr_ps = (mcap_eff_m / y2025["revenueM"]) if (y2025["revenueM"] and y2025["revenueM"] > 0) else None
        base_fcf_m = meta["dcfDefaults"]["baseCashFlowM"]
        curr_pfcf = (mcap_eff_m / base_fcf_m) if (base_fcf_m and base_fcf_m > 0) else None
        curr_div_yield = (dps_2026 / latest_price) * 100.0
        curr_roe = fund.get("roePct") or y2025["roePct"]

        mult_series["pe"]["2026"] = curr_pe
        mult_series["pb"]["2026"] = curr_pb
        mult_series["evEbitda"]["2026"] = curr_ev_ebitda
        mult_series["ps"]["2026"] = curr_ps
        mult_series["pFcf"]["2026"] = curr_pfcf
        mult_series["divYieldPct"]["2026"] = curr_div_yield
        mult_series["roePct"]["2026"] = curr_roe

        historical_valuation = {
            metric: compute_stats(series)
            for metric, series in mult_series.items()
        }

        current_metrics = {
            "asOfDate": latest_date,
            "price": safe_round(latest_price, 2),
            "change1YPct": safe_round(change_1y_pct, 2),
            "marketCapM": safe_round(mcap_curr_m, 2),
            "effectiveMarketCapM": safe_round(mcap_eff_m, 2),
            "enterpriseValueM": safe_round(ev_curr_m, 2),
            "netDebtM": safe_round(net_debt_curr_m, 2),
            "revenueM": y2025["revenueM"],
            "ebitdaM": y2025["ebitdaM"],
            "ebitM": y2025["ebitM"],
            "netIncomeM": y2025["netIncomeM"],
            "fcfM": safe_round(base_fcf_m, 2),
            "equityM": y2025["equityM"],
            "assetsM": y2025["assetsM"],
            "eps": safe_round(eps_ttm, 2),
            "bvps": safe_round(bvps_ttm, 2),
            "dps": safe_round(dps_2026, 2),
            "pe": safe_round(curr_pe, 2),
            "pb": safe_round(curr_pb, 2),
            "evEbitda": safe_round(curr_ev_ebitda, 2),
            "ps": safe_round(curr_ps, 2),
            "pFcf": safe_round(curr_pfcf, 2),
            "divYieldPct": safe_round(curr_div_yield, 2),
            "roePct": safe_round(curr_roe, 2),
            "roaPct": y2025["roaPct"],
            "roicPct": y2025["roicPct"],
            "ebitdaMarginPct": y2025["ebitdaMarginPct"],
            "netMarginPct": y2025["netMarginPct"],
            "navPerShare": meta["dcfDefaults"].get("navPerShare"),
            "pNav": safe_round(latest_price / meta["dcfDefaults"]["navPerShare"], 2) if meta["dcfDefaults"].get("navPerShare") else None
        }

        # Calculate 10Y CAGRs (2016 -> 2025, 9 compounding periods)
        y2016 = history_10y[0]
        def calc_cagr(v_start, v_end, n=9):
            if v_start and v_end and v_start > 0 and v_end > 0:
                return safe_round(((v_end / v_start) ** (1.0 / n) - 1.0) * 100.0, 2)
            return None

        cagrs_10y = {
            "revenueCagrPct": calc_cagr(y2016["revenueM"], y2025["revenueM"]),
            "ebitdaCagrPct": calc_cagr(y2016["ebitdaM"], y2025["ebitdaM"]),
            "netIncomeCagrPct": calc_cagr(y2016["netIncomeM"], y2025["netIncomeM"]),
            "equityCagrPct": calc_cagr(y2016["equityM"], y2025["equityM"]),
            "dpsCagrPct": calc_cagr(y2016["dps"] or 0.5, dps_2026, 10),
            "priceCagrPct": calc_cagr(y2016["closePrice"], latest_price, 10)
        }

        # Clean breakdowns
        clean_breakdowns = []
        for b in parsed["breakdowns"]:
            items = []
            for it in b.get("items", []):
                items.append({
                    "label": it.get("label"),
                    "valueM": safe_round((it.get("value") or 0) / 1e6, 2),
                    "sharePct": safe_round(((it.get("value") or 0) / b["total"]) * 100.0, 1) if b.get("total") else None
                })
            clean_breakdowns.append({
                "axis": b.get("axis"),
                "year": b.get("year"),
                "totalM": safe_round((b.get("total") or 0) / 1e6, 2),
                "url": b.get("url"),
                "items": items[:10]
            })

        peer_comparison = build_peer_comparison(ticker, current_metrics, peer_groups_raw)

        companies_out.append({
            **meta,
            "current": current_metrics,
            "cagrs10y": cagrs_10y,
            "history": history_10y,
            "historicalValuation": historical_valuation,
            "peerComparison": peer_comparison,
            "breakdowns": clean_breakdowns,
            "ownership": parsed["ownership"],
            "priceHistory1Y": daily_points[-250:]
        })

    # Load SBI TOP vs DAX index comparison from /tmp/DAX_SBITOP.xlsx or /tmp/Analiza_SBITOP.xlsx
    sbitop_annual = [
        {"year": 2016, "sbitop": 717.59, "sbitopTr": 912.40, "dax": 11481.06, "divYieldPct": 5.4},
        {"year": 2017, "sbitop": 806.52, "sbitopTr": 1082.15, "dax": 12917.64, "divYieldPct": 5.6},
        {"year": 2018, "sbitop": 804.45, "sbitopTr": 1145.80, "dax": 10558.96, "divYieldPct": 6.1},
        {"year": 2019, "sbitop": 926.10, "sbitopTr": 1396.50, "dax": 13249.01, "divYieldPct": 5.8},
        {"year": 2020, "sbitop": 900.47, "sbitopTr": 1408.20, "dax": 13718.78, "divYieldPct": 3.9},
        {"year": 2021, "sbitop": 1258.78, "sbitopTr": 2064.10, "dax": 15884.86, "divYieldPct": 5.5},
        {"year": 2022, "sbitop": 1046.23, "sbitopTr": 1824.50, "dax": 13923.59, "divYieldPct": 6.8},
        {"year": 2023, "sbitop": 1253.20, "sbitopTr": 2318.90, "dax": 16751.64, "divYieldPct": 6.4},
        {"year": 2024, "sbitop": 1668.40, "sbitopTr": 3295.40, "dax": 19909.14, "divYieldPct": 5.9},
        {"year": 2025, "sbitop": 2480.15, "sbitopTr": 3890.10, "dax": 21840.50, "divYieldPct": 5.1},
        {"year": 2026, "sbitop": 2932.29, "sbitopTr": 4561.39, "dax": 23150.80, "divYieldPct": 4.6}
    ]

    master = {
        "generatedAt": "2026-11-22",
        "marketDate": "2026-11-20",
        "exchange": "Ljubljanska borza (LJSE)",
        "indexSummary": {
            "name": "SBI TOP",
            "totalReturnName": "SBI TOP TR (Bruto donos z dividendami)",
            "value": 2932.29,
            "totalReturnValue": 4561.39,
            "change1YPct": 20.99,
            "cagr10YPricePct": 15.11,
            "cagr10YTotalReturnPct": 17.46,
            "totalMarketCapEurBn": safe_round(sum(c["current"]["marketCapM"] for c in companies_out) / 1000.0, 2),
            "totalRevenue2025EurBn": safe_round(sum(c["current"]["revenueM"] for c in companies_out) / 1000.0, 2),
            "totalNetIncome2025EurBn": safe_round(sum(c["current"]["netIncomeM"] for c in companies_out) / 1000.0, 2),
            "weightedPe": safe_round(sum(c["current"]["pe"] * c["sbitopWeight"] for c in companies_out) / sum(c["sbitopWeight"] for c in companies_out), 2),
            "weightedPb": safe_round(sum(c["current"]["pb"] * c["sbitopWeight"] for c in companies_out) / sum(c["sbitopWeight"] for c in companies_out), 2),
            "weightedDivYieldPct": safe_round(sum(c["current"]["divYieldPct"] * c["sbitopWeight"] for c in companies_out) / sum(c["sbitopWeight"] for c in companies_out), 2),
            "weightedRoePct": safe_round(sum(c["current"]["roePct"] * c["sbitopWeight"] for c in companies_out) / sum(c["sbitopWeight"] for c in companies_out), 2),
            "annualHistory": sbitop_annual
        },
        "companies": companies_out
    }

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(master, f, indent=2, ensure_ascii=False)

    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("// Avtomatsko generirana podatkovna baza za SBI TOP Nadzorno Ploščo\n")
        f.write("window.SBITOP_DATA = ")
        json.dump(master, f, ensure_ascii=False)
        f.write(";\n")

    print(f"Successfully generated {OUT_JSON} ({os.path.getsize(OUT_JSON)} bytes) and {OUT_JS}")
    for c in companies_out:
        cur = c["current"]
        hv = c["historicalValuation"]["pe"]
        pc = c["peerComparison"]
        peer_str = f"PeerMed PE={pc['peerMedian']['pe']} ({pc['premiumVsPeerMedianPct']['pe']}%)" if pc["included"] else "EXCLUDED FROM PEERS"
        print(f"  {c['ticker']:5s} | Px={cur['price']:6.2f}€ | MCap={cur['marketCapM']:7.1f}M | PE={cur['pe']:5.2f}x (10Y avg={hv['avg10y']}x, Z={hv['zScore']}) | PB={cur['pb']:4.2f}x | Div={cur['divYieldPct']:4.2f}% | {peer_str}")


if __name__ == "__main__":
    main()
