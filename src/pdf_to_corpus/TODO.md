# PDF to Corpus TODO

## 1. Indexer Upgrades (indexer.py)
- [x] **OCR Fallback:** Ενσωμάτωση του `tools/ocr.py` ώστε αν μια σελίδα δεν έχει text, να τρέχει αυτόματα OCR πριν την ανάλυση.
- [x] **Article Range Detection:** Αναβάθμιση της λογικής ώστε να βρίσκει την αρχή ΚΑΙ το τέλος κάθε άρθρου (π.χ. Άρθρο 5: Σελίδες 10-14).
- [x] **Table of Contents (ToC) Fix:** Ενσωμάτωση της λογικής από το `test_indexer_fix.py` για την αποφυγή λανθασμένων εγγραφών από τα περιεχόμενα.
- [ ] **AI-Powered Indexing:** Χρήση LLM (μία φορά κατά το ingestion) για την παραγωγή Περιλήψεων (Summaries) και Tags για κάθε άρθρο.

## 2. Tools Optimization
- [ ] **Docling Integration:** Αξιοποίηση του `tools/docling_loader.py` για καλύτερη αναγνώριση της δομής (headers, tables).
- [ ] **Parallel Processing:** Υποστήριξη παράλληλης επεξεργασίας πολλών PDF για ταχύτητα.
- [ ] **Metadata Extraction:** Βελτίωση του regex για την εξαγωγή Law Number και ΦΕΚ Series σε δύσκολες περιπτώσεις.

## 3. Output Quality
- [ ] **Markdown Schema:** Εφαρμογή του νέου σχήματος Markdown (front-matter με tags/summary και λεπτομερής χάρτης πλοήγησης).
- [ ] **Categorization:** Αυτόματη τοποθέτηση του παραγόμενου index στον σωστό φάκελο (`book_A`, `book_B` κλπ).
