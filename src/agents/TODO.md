# Agents TODO

## 1. Core Agents Development
- [ ] **Index/Search Agent:** Δημιουργία νέου Agent (ή αναβάθμιση του listing_agent) που θα κάνει search στα metadata και τα tags των Markdown στο `corpus/index/`.
- [ ] **Vision Reader Agent:** 
  - [ ] Αναβάθμιση ώστε να δέχεται range σελίδων (π.χ. [10, 11, 12]).
  - [ ] Υλοποίηση "Image Stitching" ή αποστολή πολλαπλών εικόνων στο LLM για μεγάλα άρθρα.
- [ ] **Rewriter Agent:** Βελτίωση των prompts για καλύτερη εξαγωγή νομικών φίλτρων (Νόμος, Άρθρο κλπ).

## 2. Tools (agents/tools/)
- [ ] **Vision Tool:** Βελτίωση του `vision_reader.py` για υψηλότερη ποιότητα εικόνας (DPI tuning) και υποστήριξη grayscale για μείωση tokens.
- [ ] **Search Tool:** Δημιουργία εργαλείου που κάνει γρήγορο grep/search στα τοπικά Markdown αρχεία.

## 3. Reasoning & Flow
- [ ] **Reasoning Loop:** Σχεδιασμός της λογικής "Αν δεν βρεις το άρθρο στον index, δοκίμασε θεματική αναζήτηση στα tags".
- [ ] **Citation Verification:** Ο Combiner Agent πρέπει να διασταυρώνει αν η απάντηση προέρχεται όντως από τη σελίδα που "είδε" ο Vision Reader.
- [ ] **MCP Integration:** Μετατροπή των κλήσεων των agents σε MCP tools για συμβατότητα με εξωτερικά AI clients.
