# SBI TOP Institucionalni Analitični & Vrednotenjski Terminal (LJSE 2016–2026)

Interaktivna nadzorna plošča in analitični terminal za spremljanje poslovanja, zadnjih objavljenih četrtletnih rezultatov (H1 & 9M 2026), **pravih TTM kazalnikov** (`FY 2025 + 9M 2026 − 9M 2025`), izračuna poštene vrednosti (**Normaliziran 5L DCF** za nefinančne družbe ter **Model presežnega donosa kapitala / Residual Income** za banko in zavarovalnici), **obratnega DCF (Reverse DCF)**, primerjave s **54 tujimi primerljivimi podjetji** ter **simulatorja lastnega portfelja in 5-letnega dividendnega koledarja** za družbe v indeksu **SBI TOP** na **Ljubljanski borzi (LJSE)**.

---

## Ključne metodološke nadgradnje

1. **Pravi TTM (`Trailing Twelve Months = FY 2025 + 9M 2026 − 9M 2025`)**:
   - Stolpec `2026 TTM` in vsi tekoči kazalniki vrednotenja (`P/E`, `P/B`, `EV/EBITDA`, `P/S`, `ROE`) temeljijo na dejanskih drsečih 12 mesecih (npr. pri Krki rast TTM čistega dobička na `432,8 M€` in `TTM P/E 17,51x`; pri Petrolu in Cinkarni Celje upoštevan medletni upad 9M 2026 dobička, kar da pravi `TTM P/E 15,64x` za Petrol in `12,37x` za Cinkarno).
2. **Enotno število delnic brez zakladnih delnic (MSRP 33) skozi vsa leta**:
   - Odpravljen prelom števila delnic med letom 2025 in TTM: `EPS`, `BVPS`, tržna kapitalizacija in `EV` v vseh letih uporabljajo efektivno število delnic brez lastnih delnic (`sharesEffectiveM`), z ločeno navedbo celotnih izdanih delnic (`sharesIssuedM`).
3. **Agregatni (Harmonični) P/E in P/B indeksa ter rebasirane uteži (`100,00 %`)**:
   - Namesto pristranskega aritmetičnega povprečja P/E je uporabljen **agregatni P/E indeksa** ($\sum \text{Tržna kap.} / \sum \text{TTM Čisti dobiček} = 12,87\text{x}$, harmonični tehtani P/E `12,61x`) in agregatni `P/B 1,81x`.
4. **Normaliziran 5-letni FCF + Odbitek za operativni denarni blažilnik (Operating Cash Buffer Haircut)**:
   - Za nefinančne družbe simulator privzeto uporablja **normaliziran 5-letni FCF** (z možnostjo preklopa med *Normaliziranim FCF*, *5L aritmetičnim povprečjem*, *3L povprečjem* in *Vrhom FY 2025*). Pri izračunu čistega dolga za vrednotenje se od bruto denarnih sredstev odšteje operativni denarni blažilnik (`3–4 %` letnih prihodkov).
5. **Model presežnega donosa kapitala (`Residual Income / EVA = (ROE − ke) × Kapital`) za finančne ustanove**:
   - Za **NLB Skupino (`NLBR`)**, **Zavarovalnico Triglav (`ZVTG`)** in **Savo Re (`POSR`)** se namesto FCF uporablja model presežnega donosa kapitala (`ROE` proti strošku lastniškega kapitala $k_e$ na knjigovodski kapital $B_0$) in upravičeni `P/B` večkratnik.
6. **Enotna definicija varnostne rezerve (`Implicirani MoS = 1 − Tečaj / IV`) in Obratni DCF (`Reverse DCF`)**:
   - Ločen in nedvoumen prikaz **Implicirane varnostne rezerve** ($\text{MoS} = \frac{\text{IV} - \text{Tečaj}}{\text{IV}}$) in **Potenciala rasti** ($\text{Upside} = \frac{\text{IV} - \text{Tečaj}}{\text{Tečaj}}$) ter izračun **Obratnega DCF** (kakšno 10-letno rast FCF oz. kakšen vzdržni ROE trenutni tečaj že vračunava).

---

## Presečni povzetek vrednotenja družb v SBI TOP (Pravi TTM · 20. 11. 2026)

| Simbol | Podjetje | Model vrednotenja | Utež (Rebas.) | Tečaj (€) | Eff. MCap (mio €) | TTM Čisti dob. (FY25) | Pravi TTM P/E | 10L Povp. P/E | Mediana 6 tujih P/E | Premija (+) / Diskont (−) vs. Tuji | TTM P/B | Div. donos | TTM ROE |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **KRKG** | Krka, d. d. | Norm. 5L DCF | 30,10 % | 248,00 € | 7.577,9 | 432,8 M€ *(403,7)* | **17,51x** | 11,28x | 16,90x | +3,6 % (premija) | 3,05x | 3,67 % | 17,4 % |
| **NLBR** | NLB Skupina | Residual Income | 20,59 % | 212,00 € | 4.240,0 | 524,8 M€ *(518,7)* | **8,08x** | 5,21x | 7,25x | +11,4 % (premija) | 1,09x | 6,53 % | 13,5 % |
| **PETG** | Petrol, d. d. | Norm. 5L DCF | 14,30 % | 55,00 € | 2.261,9 | 144,7 M€ *(174,2)* | **15,64x** | 8,67x | 6,80x | +130,0 % (premija) | 2,13x | 4,55 % | 13,6 % |
| **ZVTG** | Zavarovalnica Triglav | Residual Income | 10,69 % | 68,60 € | 1.559,6 | 137,2 M€ *(136,7)* | **11,37x** | 8,36x | 9,00x | +26,3 % (premija) | 1,42x | 4,37 % | 12,5 % |
| **LKPG** | Luka Koper, d. d. | Norm. Owner Earn. | 7,88 % | 109,00 € | 1.526,0 | 88,7 M€ *(81,5)* | **17,20x** | 8,71x | 10,15x | +69,5 % (premija) | 2,20x | 2,11 % | 12,8 % |
| **POSR** | Sava Re | Residual Income | 7,54 % | 78,80 € | 1.221,2 | 123,5 M€ *(114,0)* | **9,88x** | 6,61x | 8,95x | +10,4 % (premija) | 1,56x | 3,49 % | 15,8 % |
| **TLSG** | Telekom Slovenije | Norm. 5L DCF | 5,24 % | 143,00 € | 930,3 | 68,2 M€ *(60,5)* | **13,63x** | 9,93x | 14,60x | **-6,6 % (diskont)** | 1,27x | 3,22 % | 9,3 % |
| **SALR** | Salus, d. d. | Norm. 5L DCF | 2,17 % | 59,00 € | 484,9 | 18,3 M€ *(17,0)* | **26,55x** | 14,48x | 22,10x | +20,1 % (premija) | 4,98x | 2,03 % | 18,8 % |
| **CICG** | Cinkarna Celje, d. d. | Norm. 5L DCF | 1,49 % | 27,30 € | 212,4 | 17,2 M€ *(19,5)* | **12,37x** | 8,22x | 14,35x | **-13,8 % (diskont)** | 0,97x | 6,59 % | 7,8 % |

---

## Arhitektura repozitorija

- `index.html` — Glavna spletna stran z levim navigacijskim menijem, zložljivimi moduli, SEO/Open Graph oznakami in `@media print` enostranskim PDF Tear Sheetom.
- `styles.css` — Institucionalni temni oblikovni slog (`Inter` + `JetBrains Mono` tabularne številke).
- `app.js` — Aplikacijska logika za vseh 7 modulov, DCF in Residual Income vrednotenje, Obratni DCF, Zgodovino IV, ±1σ zgodovinske pasove in Portfeljski simulator.
- `data/sbitop_data.json` & `data/sbitop_data.js` — Konsolidirana 10-letna in TTM podatkovna baza (2016–2026 TTM).
- `scripts/build_dataset.py` — Python skripta za gradnjo in validacijo podatkovnega modela.
- `.github/workflows/update_sbitop_data.yml` — GitHub Actions cevovod za samodejno dnevno osveževanje podatkov.
