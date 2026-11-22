# SBI TOP Institucionalni Analitični & Vrednotenjski Terminal (LJSE 2016–2026)

Interaktivna nadzorna plošča in analitični terminal za spremljanje poslovanja, zadnjih objavljenih četrtletnih rezultatov (H1 & 9M 2026), **pravih TTM kazalnikov** (`FY 2025 + 9M 2026 − 9M 2025`), izračuna poštene vrednosti (**Normaliziran DCF na 5-letni mediani FCF** za nefinančne družbe ter **Model presežnega donosa kapitala / Residual Income z bledenjem ROE** za banko in zavarovalnici), **obratnega DCF (Reverse DCF)**, primerjave z **68 tujimi primerljivimi podjetji** ter **simulatorja lastnega portfelja in 5-letnega koledarja prihodnjih neizplačanih dividend** za družbe v indeksu **SBI TOP** na **Ljubljanski borzi (LJSE)**.

---

## Ključna metodološka pravila in podatkovna integriteta

1. **Brez izmišljenih podatkov (`null` $\rightarrow$ `"ni podatka"`)**:
   - Odstranjena je kakršnakoli rezervna formula za izračun manjkajočih zaključnih tečajev. Kjer tečaja ali kazalnika ni (npr. `NLBR` v letih 2016 in 2017 pred uvrstitvijo na LJSE novembra 2018, ali `P/E` v letih z negativnim čistim dobičkom pri `PETG` 2022 in `ZVTG` 2022 po prerazvrstitvi MSRP 17), je vrednost v JSON zapisana kot `null` in v uporabniškem vmesniku prikazana kot **`"ni podatka"`** ter izločena iz zgodovinskih povprečij.
   - Zaključna tečaja za leto 2022 pri **Petrolu (`20,00 €`)** in **Zavarovalnici Triglav (`34,50 €`)** sta vzeta iz uradnih zaključnih tečajev LJSE na dan 30. 12. 2022 (`data/raw/companies_raw.json`).
2. **Pravi TTM (`Trailing Twelve Months = FY 2025 + 9M 2026 − 9M 2025`) in enotno število delnic (MSRP 33)**:
   - Vsi kazalniki na delnico (`EPS`, `BVPS`), tržna kapitalizacija in `EV` skozi vsa leta (2016–2025 in 2026 TTM) uporabljajo enotno število delnic brez zakladnih delnic (`sharesEffectiveM`).
   - Ne seštevamo neprimerljivih prihodkov industrij, trgovine z energenti, bančnih obrestnih prihodkov in zavarovalnih premij na ravni indeksa; v glavi Modula 1 prikazujemo skupno tržno kapitalizacijo (`19,99 mrd €` brez lastnih delnic / `20,76 mrd €` z zakladnimi delnicami) in **skupni TTM čisti dobiček (`1,55 mrd €`)**.
3. **Izračun FCF povprečij neposredno iz `history` in enotna definicija Normaliziranega FCF**:
   - `fcf5yAvgM` (5-letno aritmetično povprečje 2021–2025), `fcf3yAvgM` (3-letno povprečje 2023–2025) in `fcfPeak2025M` (dejanski FCF v FY 2025, vključno z `-11,00 M€` pri Luki Koper) se izračunajo neposredno iz zgodovinske serije `history`.
   - **Normalizirani FCF (`fcfNormalizedM`)** je za vse nefinančne družbe opredeljen z enim dokumentiranim pravilom: **`5-letna mediana FCF (2021–2025)`**.
4. **Enotno pravilo za operativni denarni blažilnik v čistem dolgu**:
   - Pri vseh nefinančnih družbah se od bruto denarnih sredstev pred izračunom čistega dolga odšteje operativni denarni blažilnik po enotni formuli:
     $$\text{Operativni denarni blažilnik} = \min(\text{Bruto denar},\; 2,0\,\% \times \text{TTM Prihodki})$$
5. **Luka Koper (`LKPG`) — Naložba v delnice Krke in razvojni CAPEX cikel `785 M€`**:
   - V prehodu iz `EV` v vrednost lastniškega kapitala je eksplicitno vključena finančna naložba Luke Koper v **433.786 delnic Krke (`KRKG`)**, vrednotena po tečaju `248,00 €` z **20 % odbitkom za likvidnost in davek = `+86,06 M€` (`+6,15 €/delnico`)**.
   - V simulatorju je dodano eksplicitno opozorilo in vnosno polje za odštetje sedanje vrednosti načrtovanega razvojnega investicijskega cikla **`785 M€` (2024–2028)**.
6. **Model presežnega donosa kapitala (`Residual Income`) za banko in zavarovalnici (`NLBR`, `ZVTG`, `POSR`)**:
   - Uporablja izplačilno razmerje (`payoutRatioPct = DPS / TTM EPS`) za zadržano rast knjigovodske vrednosti $g_{\text{BV}} = \text{ROE}_t \times (1 - \text{payout})$, **linearno bledenje ROE proti $k_e$** v 2. fazi (leta 6–10) in terminalnem obdobju, izpis **CAPM sestave stroška lastniškega kapitala** ($k_e = R_f + \beta \times \text{ERP}$) ter **2D matriko občutljivosti IV glede na $k_e$ ($\pm 1,5\text{ o.t.}$) in vzdržni ROE ($\pm 2,0\text{ o.t.}$)**.

---

## Presečni povzetek vrednotenja družb v SBI TOP (Pravi TTM · 20. 11. 2026)

| Simbol | Podjetje | Model vrednotenja | Utež (Rebas.) | Tečaj (€) | Eff. MCap (mio €) | TTM Čisti dob. (FY25) | Pravi TTM P/E | 10L Povp. P/E (Dejanski N) | Mediana tujih P/E (N=6–8) | Premija (+) / Diskont (−) vs. Tuji | TTM P/B | Div. donos | TTM ROE |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **KRKG** | Krka, d. d. | 5L Mediana DCF | 30,10 % | 248,00 € | 7.577,9 | 432,8 M€ *(403,7)* | **17,51x** | 11,28x *(N=10)* | 19,21x *(N=8)* | -8,8 % (diskont) | 3,05x | 3,67 % | 17,4 % |
| **NLBR** | NLB Skupina | Residual Income | 20,59 % | 212,00 € | 4.240,0 | 524,8 M€ *(518,7)* | **8,08x** | 5,21x *(N=8)* | 11,48x *(N=8)* | -29,6 % (diskont) | 1,09x | 6,53 % | 13,5 % |
| **PETG** | Petrol, d. d. | 5L Mediana DCF | 14,30 % | 55,00 € | 2.261,9 | 144,7 M€ *(174,2)* | **15,64x** | 8,78x *(N=9)* | 11,13x *(N=8)* | +40,6 % (premija) | 2,13x | 4,55 % | 13,6 % |
| **ZVTG** | Zavarovalnica Triglav | Residual Income | 10,69 % | 68,60 € | 1.559,6 | 137,2 M€ *(136,7)* | **11,37x** | 7,76x *(N=8)* | 12,51x *(N=8)* | -9,1 % (diskont) | 1,42x | 4,37 % | 12,5 % |
| **LKPG** | Luka Koper, d. d. | 5L Med. DCF + KRKG | 7,88 % | 109,00 € | 1.526,0 | 88,7 M€ *(81,5)* | **17,20x** | 8,71x *(N=10)* | 15,72x *(N=7)* | +9,4 % (premija) | 2,20x | 2,11 % | 12,8 % |
| **POSR** | Sava Re | Residual Income | 7,54 % | 78,80 € | 1.221,2 | 123,5 M€ *(114,0)* | **9,88x** | 6,61x *(N=10)* | 11,76x *(N=7)* | -16,0 % (diskont) | 1,56x | 3,49 % | 15,8 % |
| **TLSG** | Telekom Slovenije | 5L Mediana DCF | 5,24 % | 143,00 € | 930,3 | 68,2 M€ *(60,5)* | **13,63x** | 11,72x *(N=8)* | 17,03x *(N=8)* | -20,0 % (diskont) | 1,27x | 3,22 % | 9,3 % |
| **SALR** | Salus, d. d. | 5L Mediana DCF | 2,17 % | 59,00 € | 484,9 | 18,3 M€ *(17,0)* | **26,55x** | 14,48x *(N=10)* | 18,22x *(N=6)* | +45,7 % (premija) | 4,98x | 2,03 % | 18,8 % |
| **CICG** | Cinkarna Celje, d. d. | 5L Mediana DCF | 1,49 % | 27,30 € | 212,4 | 17,2 M€ *(19,5)* | **12,37x** | 8,22x *(N=10)* | 18,30x *(N=8)* | -32,4 % (diskont) | 0,97x | 6,59 % | 7,8 % |

---

## Status podatkov in Znane omejitve (Known Limitations)

### 1. Kaj je izmerjeno iz uradnih virov
- **10-letni izkazi poslovnega izida, bilance stanja in denarni tokovi (2016–2025)**: revidirana letna poročila izdajateljev (SEOnet / strukturirana zbirka Delničar.si v `data/raw/companies_raw.json`).
- **Zaključni tečaji delnic ob koncu leta (2016–2025) in tekoči tečaji (20. 11. 2026)**: uradna tečajnica Ljubljanske borze (LJSE CSV v `data/raw/companies_raw.json`), vključno s preverjenima zaključnima tečajema za leto 2022 pri `PETG` (`20,00 €`) in `ZVTG` (`34,50 €`).
- **DAX 40 (`^GDAXI`) in 68 tujih primerljivih podjetij**: dejanski tržni kazalniki pridobljeni prek `yfinance` API (`data/raw/peers_yfinance.json`) na dan **22. 11. 2026** (zaključna vrednost DAX 2025 = `24.490,41`).

### 2. Kaj je analitična ocena (v UI označeno z oznako `ocena`)
- **Bilanca stanja ob 9M / Q3 2026 (`equityM`, `assetsM`, `bvps`, `pb`)**: kjer polna medletna bilanca stanja na dan 30. 9. 2026 ni ločeno razčlenjena v surovem viru, sta kapital in bilančna vsota ocenjena iz zadnje revidirane bilance in zadržanega 9M rezultata ter označena z oznako `ocena`.
- **TTM EBIT (`ebitM` v 2026 TTM)**: pri družbah, ki v medletnih poročilih 9M 2026 poročajo EBITDA in čisti dobiček brez ločene vrstice EBIT, je sprememba TTM EBIT ocenjena kot `0,85 × ΔEBITDA` (označeno z `ocena`).
- **Zgodovinski finančni dolg 2016–2024 pri `PETG`, `LKPG`, `TLSG`, `SALR`**: v zgodovinski tabeli `data/raw/companies_raw.json` je za leta 2016–2024 podana postavka dolgoročnih obveznosti; finančni dolg za ta leta je ocenjen kot `55 %` dolgoročnih obveznosti (za leto 2025 in TTM se uporablja natančen dolg iz revidiranega letnega poročila 2025). V tabeli Modula 3 so ta zgodovinska polja označena z `ocena`.
- **ROIC (`roicPct`)**: pri izračunu NOPAT se uporablja enotna `18,0 %` efektivna davčna stopnja, TTM ROIC pa je prevzet iz zadnjega polnega poslovnega leta FY 2025 (označeno z `ocena`).

### 3. Znane metodološke omejitve
- **Majhen letni vzorec pri zgodovinskih Z-vrednostih (`vzorec ≤10 letnih točk`)**: Z-vrednosti in empirični percentili v Modulu 6 temeljijo na največ 10 letnih zaključnih opazovanjih (2016–2025). Zaradi izločitve let pred borzno kotacijo (`NLBR` 2016–2017) in let z negativnim dobičkom ali ekstremnim P/E $\ge 38\text{x}$ (`PETG` 2022, `ZVTG` 2022 in 2023, `TLSG` 2019 in 2020) znaša dejanski vzorec `N=8` pri `NLBR`, `ZVTG`, `TLSG` in `N=9` pri `PETG`.
- **Statični zajem tujih vrstnikov**: podatki za 68 tujih vrstnikov v `data/raw/peers_yfinance.json` so statični posnetek z dne **22. 11. 2026** in se v brskalniku ne osvežujejo v živo; za osvežitev je treba zagnati posodobitev `data/raw/peers_yfinance.json` in `python3 scripts/build_dataset.py`.
- **Ilustrativna zgodovina IV (2022–2026)**: graf v Modulu 4 prikazuje retrospektivni ilustrativni preračun IV po takratnih fundamentih in ni zgodovinsko arhivirana napoved iz preteklih let. Dejanski sprotni arhiv izračunanih IV ob vsaki gradnji teče v datoteki `data/iv_history.json` od 22. 11. 2026 naprej.

---

## Gradnja in avtomatska validacija (11 kontrolnih točk)

```bash
python3 scripts/build_dataset.py
python3 scripts/validate.py
node --check app.js
```
