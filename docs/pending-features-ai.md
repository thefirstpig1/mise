# Pending Features — AI inside คิดครัว

**Status:** NOTED — captured 2026-09-22 from a conversation with Kong. **NOT designed, NOT scheduled.**
**Ordering:** nothing here comes before Part 34 (deploy) closes and the first pilot shops exist. This document is a parking lot so the ideas are not re-derived from scratch later — it is not a proposal to pull any of them forward.
**Dependencies every feature below shares:** `@anthropic-ai/sdk` (new dependency), `ANTHROPIC_API_KEY` in `.env` and in `fly secrets` (an `.env` edit). Both are 🛑 items in CLAUDE.md, so **the first AI Part opens with a stop-and-ask, whichever feature it is.** No feature below needs a migration if it is built the way this document describes.

---

## Ground rules (draft — to be grilled into rules when the first AI Part happens)

These fell out of the conversation and every feature below assumes them. They are drafts, not decisions.

| # | rule | why |
|---|---|---|
| AI-1 | **AI writes drafts and previews only. Nothing an AI produced reaches `stock_movement` without a person pressing a button.** | The whole system already works this way — posting is an explicit step (ADR 0022), a draft recipe is true on no day (ADR 0025). An AI output is a draft by nature. |
| AI-2 | **AI never computes a figure.** It receives numbers the system already computed — with their coverage and confidence attached — and rearranges them into words. | A model asked to add up a table will get it wrong sometimes and nobody will know which time. Every cost figure in Mise is derived at read (ADR 0014); the AI is one more reader, not a second engine (the engine ADR 0025 Q4 refused). |
| AI-3 | **AI never sees a raw table it could draw its own conclusions from.** It gets the *decomposed* figure (Part 32's per-department split, the variance report's per-product ranking), not the rows. | Given rows, a model invents causes — "cost rose because pork got expensive" when the truth was waste. Given the decomposition, it only has to describe. |
| AI-4 | **Everything the AI is given was fetched under `requireTenant` with a capability**, the same as the page that shows it. The AI call lives in the Server Action, after the read, never as a route of its own to the database. | Rules A1–A10 and I1–I8. An AI feature is not a new door into tenant data; it is a transformation of what the page already had. |
| AI-5 | **`staff_member` and any free-text name of a person never leaves the system.** | S-rules. A bill, a menu and a product list carry no PDPA weight; a name does. |
| AI-6 | **Measure token cost with `countTokens` on real Thai data before pricing a feature.** Thai spends several times more tokens per character than English; every estimate in this document is a guess until measured. | The per-shop cost is what decides whether a feature can be free (see §Business model). |
| AI-7 | **The shop is told, in the terms, that this data goes to a third-party API.** | It leaves the Singapore Neon. Anthropic's API does not train on API traffic by default, but "by default" is not a promise a shop has read. |

---

## Feature A1: P&L page — **not an AI feature, and the prerequisite for A2**

### What is missing
Revenue − cost of goods − OpEx = net profit. All three exist: revenue (Part 19, `sales_line`), COGS by either method (Part 14 / Part 22, `tenant.gross_profit_method`), OpEx (Part 16, `expense`). **No screen puts them on one page.** `/cost` stops at gross profit; `/expenses` is a separate list. Verified 2026-09-22: no file under `src/app` prints กำไรสุทธิ.

### Shape
One page, one period, per branch and consolidated: revenue → COGS (with the method named and, under สูตรอาหาร, its coverage — rule N-series) → gross profit → OpEx by category (the seeded `OpEx / Labor` etc.) → net profit. Pure arithmetic over existing reads. Rent and electricity appear here and **only** here — they never enter a food-cost number (Part 32, Kong's correction).

### Why it is listed in an AI document
Because A2 consumes its output and nothing else. Building A2 without A1 means the AI does the arithmetic, which AI-2 forbids. A1 is worth building whether or not A2 ever happens.

---

## Feature A2: สรุป P&L เป็นภาษาคน — AI narrative over A1, several angles

### Concept
Kong, 2026-09-22: a built-in summary "ในแต่ละ angle" so the shop does not copy its figures into an outside chatbot. Three angles were named as examples — **owner** (profit, trend vs last period), **kitchen** (what went missing, cost per dish that moved), **purchasing** (which prices shifted, from which supplier).

### Why built-in beats "paste it into ChatGPT" — three real reasons, not convenience
1. **An outside model does not know our rules.** It will present a recipe-method gross profit at 40 % coverage as a fact; it will add "what a department ORDERED" to "what it USED" (F-rules forbid exactly this). Built-in, the caveats travel with the numbers because we put them in the prompt.
2. **Structure is lost in the paste.** Department, branch and product become a flat table; the outside model guesses the relationships.
3. **The data does not end up in a staff member's personal chat history.**

### Cost
One monthly report per branch, ~5–10k tokens in, ~1k out. Satang to a few baht per shop per month. **The cheapest AI feature in this document by an order of magnitude**, because it runs monthly, not per document.

### What must be true
AI-2 and AI-3 above. The prompt carries the figures, the coverage, the confidence, the period, and the *decomposed* differences (Part 32 per-department, the variance report per product) — never the ledger.

---

## Feature A3: ถ่ายบิล → ใบรับของ — bill OCR into a goods-receipt preview

### Concept
The shop photographs the supplier's invoice or delivery note. A vision call extracts lines (name as printed, qty, unit, price), the system maps each line onto `supplier_product` for that supplier (Part 1's mapping), and opens the **goods-receipt form pre-filled** for a person to correct and confirm (Part 13). Nothing posts until they do.

### Why it ranks first among the labour-savers
It is the document a shop writes most often and hates most. It is also the feature that most directly serves the pitch "30-min setup, works without recipes".

### Relationship to Feature 5 of `pending-features-v1.5.md` (attachments)
**OCR needs no storage.** The photo can be sent as base64 and discarded. *Keeping* the photo as evidence on the receipt is Feature 5 and stays blocked on an object-storage vendor. The two can ship separately; if Feature 5 lands first, A3 gets its input from the attachment instead of from a transient upload.

### Cost (guess, per AI-6)
~2.5k tokens in (one image + the supplier's product list, cached), ~0.5k out, structured output. At 10 bills/day ≈ 300/month: roughly **$1.5 (Haiku 4.5) · $3 (Sonnet 5) · $7.5 (Opus 5)** per shop per month. Blurry thermal-paper receipts and handwriting may need the larger models; measure before choosing.

### Open questions
- Does the mapping go through the existing supplier-product matching or does the model propose the match too? (Suggestion: the model extracts, the existing mapping matches, `pg_trgm` or A5 suggests the rest — one matcher, not two.)
- What does the preview show when a line matched nothing — a new product, or a refusal to proceed? (Existing Part 13 behaviour for an unmapped line should decide this, not the AI Part.)

---

## Feature A4: ร่างสูตรให้ — recipe drafting into `is_draft`

### Concept
From a menu name ("ผัดกะเพราหมูสับ") plus the shop's product list, propose a `recipe` with ingredients and quantities, mapped onto the shop's own products, written as **a draft** (`recipe.is_draft`, ADR 0025). The shop edits and publishes; publishing adopts the live line as it does today. Nothing here touches the ledger — a draft is filtered out of `recipe-resolve.ts` and `liveLinesFor` already, and those filters were verified by removal (Part 24).

### Why it matters
"Who is going to type 100 recipes" is the largest adoption barrier the product has. The coverage screen (Part 24) already ranks menus with no recipe by revenue — that list is the natural entry point: a button beside each row.

### Cost (guess)
~5k in / ~1k out per recipe, **once** per menu, not monthly. 100 menus ≈ $1 (Haiku) · $2 (Sonnet) · $5 (Opus). Model choice matters here: a model that knows Thai cooking well enough to guess 30 g of holy basil is worth more than one that guesses 300 g.

### What must be true
The draft carries its provenance ("ร่างโดย AI, ยังไม่ตรวจ") until a person edits or publishes it, so nobody mistakes an unreviewed draft for a shop's recipe. Cost confidence (Part 21) already covers the numeric side.

---

## Feature A5: จับคู่ชื่อ — name matching where `pg_trgm` is not enough

### Concept
Three places today let a trigram score *suggest* and a person *decide* (rules M9, G-series): POS menu ↔ menu, supplier product ↔ product, and the merge screen (Part 25). Trigram does not know that กระเพรา and กะเพรา are one word, or that "หมูสับ 1 กก." and "หมูบด" are one product. A small model call can rank the same candidates better.

### Boundary that must not move
**The AI suggests; it never merges, never maps, never creates.** Every rule that makes a person the decider stays. This feature replaces the *scorer*, nothing else.

### Cost
Near zero — a handful of short calls at import or mapping time, batchable.

---

## Feature A6: map คอลัมน์ไฟล์ POS — column-map suggestion for `sales_import_profile`

### Concept
A new POS format, or a header-fingerprint change that stopped an import (Part 19), currently means a person builds the column map by hand. A model can read the header row plus a few sample rows and propose the map; the person confirms; the profile is saved as today. When a fingerprint changes, the same call can *explain what changed* ("คอลัมน์ 'ส่วนลด' หายไป, มี 'Discount(฿)' เพิ่มมา").

### Boundary
The import still **stops** on a fingerprint change (ADR 0019 — the whole point is that a format change must not shift every figure silently). The AI only shortens the fix.

### Cost
Once per profile. Negligible.

---

## Feature A7: ถามตอบด้วยภาษาไทย — natural-language questions over reports — **deliberately deferred**

### Concept
"เดือนนี้หมูขึ้นเท่าไหร่" → the model calls report functions as tools and answers.

### Why it is last
- Every tool must go through `requireTenant` with a capability and must be a report function, never SQL (AI-4). That is a real design surface — the largest in this document.
- Per-interaction cost is higher than any feature above, and unpredictable.
- **A2 answers most of the questions a shop actually asks**, monthly, at a fixed cost. Build A2, watch what shops ask that it does not cover, and let that list justify A7 — or not.

---

## Feature A8: คาดการณ์การใช้วัตถุดิบ — usage forecast with seasonality (Kong, 2026-09-29)

### Concept
Kong: *"ควรมีตัวคำนวณที่ reliable ขึ้น อย่าง logic คำนวณแข็ง ๆ จากยอดขายที่ผ่านมาเป็นรายวันหรือรายเดือน หรือรายสัปดาห์ หรือแม้แต่รายปี ว่าช่วงนี้ ๆ ใช้มะนาวเยอะกว่าปกติ"*. Raised during the purchase-request grill: the stock figure lags whenever nobody has imported today's sales, so the order screen shows an ESTIMATE ("ใช้เฉลี่ยวันละ 0.8 กก. → คาดว่าเหลือ ~0.4 กก."). The first version of that estimate is a flat recent average; this feature is what replaces it.

### Split — rules first, a model only on top
Per "Where AI is the wrong tool" below, the forecast itself is **arithmetic, not a model**: usage per product per day falls out of posted `CONSUMPTION` (Part 22) and receipts/counts; the forecast weighs same-weekday history, the recent trend, and the same weeks last year (festivals, rainy season, school terms). It must be testable and explainable ("สัปดาห์นี้ปีที่แล้วใช้มากกว่าปกติ 40%").
A model may come in only to DESCRIBE — "มะนาวใช้มากผิดปกติตั้งแต่วันจันทร์ ตรงกับเมนูใหม่ยำวุ้นเส้น" — never to produce the number.

### What must be true first
- Enough history: a year of posted consumption for the yearly pattern; weeks for the weekday pattern. Show how much history the figure stands on.
- Days never imported must not read as zero usage (the same rule as SI1: per day WITH data).
- Every screen that shows it says it is a forecast.

---

## Where AI is the wrong tool

Rules beat models wherever a rule exists. None of these should use a model call:
- Price alerts vs a target price — Feature 1 of `pending-features-v1.5.md`, pure arithmetic.
- Par-level alerts (Part 17) — already rule-based.
- "This POS export covered only part of a day" — Part 20a's pulse already catches it, deterministically.
- Anything that decides. A model may rank, extract or describe; the decision stays with a person or a rule.

---

## Cost model — per shop per month

Prices are Anthropic first-party API rates as cached in the `claude-api` skill on 2026-06-24, per million tokens (input / output): **Haiku 4.5 $1/$5 · Sonnet 5 $2/$10 · Opus 5 $5/$25.** Batch API halves these for anything that does not need an answer now (A5, A6, A2's monthly run). Prompt caching charges ~10 % for the repeated part of a prompt (the shop's product list, the system prompt) — worth it for A3 and A4, where the product list is most of the input.

| feature | volume (3-branch shop) | Haiku 4.5 | Sonnet 5 | Opus 5 |
|---|---|---|---|---|
| A3 bill OCR | 300 bills | ~$1.5 | ~$3 | ~$7.5 |
| A4 recipe drafts | 100 menus, **once** | ~$1 | ~$2 | ~$5 |
| A2 P&L narrative | 3 branches × monthly | ≈ $0.05 | ≈ $0.1 | ≈ $0.3 |
| A5 / A6 matching | occasional | ≈ 0 | ≈ 0 | ≈ 0 |
| **steady state (after month 1)** | | **~$2** | **~$3** | **~$8** |

Two things the table hides:
- **Thai costs more tokens than English.** These figures are guesses until AI-6 is done on real bills and real menus.
- Against a subscription of ฿300–1,000/month ($9–30), $2–8 is **7–30 % of revenue** — not nothing, and the reason the model is chosen per feature by measurement rather than "the best one everywhere". The `claude-api` skill's own rule applies: model choice is Kong's decision, not the code's default.

---

## Business model — direction captured, split NOT decided

Kong, 2026-09-22, considered making the product free and funding it with advertising, and after discussion **preferred freemium**. Recorded here because it decides which features above can ever be given away.

### Why not free + display ads
- A back-office tool is opened by 2–3 people per shop for a few minutes a day — roughly 1–2 thousand page views per shop per month. Display advertising in Thailand pays tens of baht per thousand views, so **a shop is worth tens of baht a month in ads** against ฿300–500 in subscription: ads need something like ten times the shops to earn the same money, and B2B pages that people use for minutes are not where advertisers want to be.
- The advertising that *is* valuable in this vertical is **supplier placement** — the system knows what each shop buys, at what price, from whom. That is lead-gen, not banners, and it only works with enough shops in one area. It also puts the shop's purchase data on the table, which touches PDPA and the trust a back-office product runs on. Parked, not rejected.

### Why freemium fits the code that exists
- The marginal cost of a shop with no AI features is close to zero: rows in one Neon database and page reads on one Fly machine. A free tier is affordable at hundreds of shops.
- **AI features are the thing that cannot be free.** A3 alone is $1.5–7.5 per shop per month; ads would not cover it. The one AI feature cheap enough to give away is A2.
- The price of zero does not remove the real friction (30 minutes of setup, a POS export, master data). The first ten shops will be free regardless — they are pilots. **The free/paid line can be drawn after the pilots show who has more than one branch and what they will pay for.**

### What is NOT decided — an open item for a session of its own
Kong wants to **lay every feature out on the table** and sort it into two piles: **fundamental** (free — what the app *is*) and **premium** (paid — labour-savers a shop opts into, OCR being the named example). Two candidate axes came up in conversation, neither chosen:
- by *kind* — recording, counting and reporting free; automation (A3, A4) paid;
- by *size* — one branch free, multi-branch paid (branch reach and `all_branches` already draw this line in code; multi-branch shops are the ones the product hurts most for).

They are not exclusive. Deciding needs the feature list in front of both of us, not a paragraph here.

### One consequence that is already true
Free sign-up multiplies traffic on `/login`, which is a public email cannon (ADR 0031). **หมุด B's domain + SPF/DKIM moves earlier**, not later, the moment sign-up is free.

### Tiers follow cost — captured 2026-09-29, NOT decided
Kong: each price tier has a different cost, so each tier's features should match what it costs. The first example: the free tier never uses AI, but it still uses photo storage, so **how long bill photos are kept back could be a tier feature** (higher tiers keep them longer). The 2026-09-29 burn-rate estimate found three costs that grow with use: **AI calls, LINE push messages and stored photos**. Each one needs a cap per tier. For photo retention, the grill must check how long Thai law requires a shop to keep its documents, and decide whether an old photo is deleted or moved to cheaper storage. A shop must be able to export its photos before anything is removed.

### Open calculation logic for outside audit — captured 2026-09-29, do at launch
Kong: a shop deciding whether to trust คิดครัว will want to know the numbers are exact, so **publish the calculation logic so the shop can give it to an AI (or an accountant) to audit**. Feasible, because the rules already live in one place (`docs/calculation-rules.md` plus the ADRs). What it needs:
1. **A public "วิธีคำนวณ" page in plain Thai**: each rule, its formula and one worked example, including the rounding rules. Without them an honest recompute differs by satang and reads as a bug. Known case: PR3a (exclusive multi-line receipts for a non-reclaimable shop), which must be fixed or stated first.
2. **A per-shop "ชุดตรวจสอบ" export**: the raw inputs (receipts, stock movements, counts, sales) plus the figures the system printed, so an auditor checks the shop's own numbers as well as the logic. Tell the auditor to recompute with code or a spreadsheet, not in its head; a model doing arithmetic in prose is the least reliable auditor.
3. **Published only as calculation, never as security or infrastructure detail.**

**The rule this feature stands on (Kong, 2026-09-29):** *"อันนี้คือโจทย์ที่เราต้องซื่อสัตย์ที่สุด ห้าม prompt ให้เอไอที่ลูกค้าใช้ตรวจสอบเรามาเข้าข้างเราโดยเด็ดขาด หรือถ้าให้ดี prompt ให้พยายามจับผิด … ที่เราต้องการไม่ใช่ให้ลูกค้าหลงเชื่อ แต่ต้องการให้ลูกค้าเชื่อใจแล้วรู้ว่าเรา honest ที่สุด"*
- **Nothing we publish tries to steer the auditor.** The rules page and the export carry no text aimed at a model: no "this has been verified", no "trust these figures", no hidden instructions. The customer's AI reads our files, so a persuasive sentence inside them is prompt injection against our own customer. A test should fail when the published files contain instruction-like text.
- **The only prompt we supply is an adversarial one, shown in full and editable.** It tells the auditor to try to break the numbers: recompute every figure independently with code, look for rounding drift, double counting, dates in the wrong period and stock that appears from nowhere, report every mismatch however small, and never assume the system is right. The customer can read it, change it or use their own.
- **Known limitations are published before anyone finds them**: PR3a's satang drift, a PREPPED count that always reports a gain (no production movements), the periodic method's dependence on a complete count, and every figure printed with its coverage or confidence. An auditor who finds a flaw we already listed learns that we tell the truth. One who finds a flaw we hid learns the opposite.
- **A discrepancy is a bug report, not a support ticket**: an easy way to send the auditor's finding, and a public log of calculation corrections (what was wrong, since when, which figures moved).

---

## Local models — a fixed-cost path, captured 2026-09-22, NOT designed

Kong asked whether the app could talk to a model **we run ourselves on a GPU** instead of a frontier API. Technically yes: Ollama / llama.cpp / vLLM expose an HTTP API, open-weight models exist for vision (Qwen-VL) and for Thai (Typhoon by SCB 10X, OpenThaiGPT). The point that makes this an idea worth keeping rather than a decision: **it is the same reversibility pattern as ADR 0031 (email) and ADR 0033 (host)** — if `src/lib/ai/` is an interface at the level of *our* jobs (`extractBill(image) → lines`, `narratePnl(figures) → text`), not at the level of a vendor SDK, then the provider is one config value.

Where it differs from running a model at home:
- **It is a server, not a laptop.** The app is on Fly in Singapore; a GPU must be reachable 24/7. A rented always-on GPU is tens of thousands of baht a month against $2–8 per shop on the API — break-even is on the order of **a hundred shops using AI**. Scale-to-zero GPUs fix the bill but cost 30–90 s to load weights: fine for A2 (monthly) and A4 (a person waiting for a draft), **not for A3** (a person holding a phone at the back door).
- **Quality on Thai receipts is unknown until measured.** A5 and A2 are within reach of a small model; A3 is the risky one.
- **One more thing for one person to operate** — drivers, VRAM, model updates — which is the cost ADR 0033 was written to avoid.

What only the local path gives: **data never leaves the system** (AI-7 dissolves), and the cost becomes **fixed instead of per call** — past break-even, giving AI away inside freemium becomes possible, which reverses the sentence "AI features are the thing that cannot be free" above.

Direction, not decision: start on the API (nothing to operate, pay per use, right-sized for 0–100 shops), keep the interface vendor-free, move when volume says so. **The move is safe only with an eval set** — see O42.

---

## Open questions for the grill, when it happens
- O36: Which feature is the first AI Part? (Suggestion from the 2026-09-22 conversation: **A1 + A2** — cheapest, no new input path, teaches the shop what AI in the product looks like; A3 second, once the cost per shop is measured on real bills.)
- O37: Where does the AI call live — inside the existing Server Action after the read (AI-4), or in a small `src/lib/ai/` module that Server Actions call? (The second, probably, so the prompt and the model choice have one home.)
- O38: Model per feature — decided by measurement on Thai data (AI-6), per feature, never globally.
- O39: What does the screen say when the API is down or the key is missing? (Precedent: Part 31's `skipped` — a dev machine with no key has not *failed* to draft anything. The feature degrades to the manual path, which still exists for every feature above.)
- O40: Retention and terms — what the shop is told, and whether any feature needs an opt-in per shop.
- O41: Does A3 want the photo kept (Feature 5) or discarded? The shops will answer this: a bill that was OCR'd and then thrown away has no evidence behind it.
- O42: **An eval set from the first AI Part onward, whichever provider is used** — ~50 real bills and ~50 real menus with the answer a person would give. Switching model or provider (API ↔ local, one model tier ↔ another) is then a measured comparison, not an eyeballed one. Without it, every switch is a guess about quality, and the day a cheaper model is wrong nothing reports it.
