# Project TODO (General)

## 1. Directory Reorganization (Data Flow)
- [ ] **Data Migration:** Μετακίνηση του φακέλου `downloads/` σε `corpus/raw/`.
- [ ] **Index Structure:** Οργάνωση του `corpus/index/` με βάση το έτος και την κατηγορία ΦΕΚ (π.χ. `corpus/index/2025/book_A/`).
- [ ] **Config Update:** Ενημέρωση του `src/config.py` για τις νέες διαδρομές (paths).
- [ ] **CLI Update:** Προσαρμογή του `src/main.py` ώστε να υποστηρίζει τη νέα δομή και να καλεί τον σωστό indexer.

## 2. Infrastructure & Standards
- [ ] **Logging:** Ενσωμάτωση κεντρικού logging για την παρακολούθηση της διαδικασίας ingestion.
- [ ] **Error Handling:** Βελτίωση του error handling κατά το άνοιγμα "καταστραμμένων" ή πολύ μεγάλων PDF.
- [ ] **Requirements:** Έλεγχος και ενημέρωση του `requirements.txt` με τις νέες βιβλιοθήκες (π.χ. MCP server libs, multimodal providers).

## 3. Integration
- [ ] **MCP Server:** Σχεδιασμός και υλοποίηση του βασικού MCP server που θα εκθέτει τα tools των agents.
- [ ] **End-to-End Test:** Δημιουργία ενός test script που θα προσομοιώνει την πλήρη ροή από την ερώτηση μέχρι την οπτική ανάλυση.
