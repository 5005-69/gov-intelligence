import os
import fitz
import re
from pathlib import Path
from src.config import settings
from src.pdf_to_corpus.tools.ocr import ensure_ocr

def normalize_for_match(text):
    """Καθαρίζει το κείμενο ΜΟΝΟ για τις ανάγκες των Regex (όχι για εκτύπωση)."""
    if not text: return ""
    norm_text = text.upper()
    accents = {
        'Ά': 'Α', 'Έ': 'Ε', 'Ή': 'Η', 'Ί': 'Ι', 'Ό': 'Ο', 'Ύ': 'Υ', 'Ώ': 'Ω',
        'Ϊ': 'Ι', 'Ϋ': 'Υ', 'ά': 'Α', 'έ': 'Ε', 'ή': 'Η', 'ί': 'Ι', 'ό': 'Ο', 'ύ': 'Υ', 'ώ': 'Ω',
        'ϊ': 'Ι', 'ϋ': 'Υ', 'ΐ': 'Ι', 'ΰ': 'Υ'
    }
    for acc, no_acc in accents.items():
        norm_text = norm_text.replace(acc, no_acc)
        
    mapping = {
        'A': 'Α', 'B': 'Β', 'E': 'Ε', 'Z': 'Ζ', 'H': 'Η', 'I': 'Ι',
        'K': 'Κ', 'M': 'Μ', 'N': 'Ν', 'O': 'Ο', 'P': 'Ρ', 'T': 'Τ',
        'X': 'Χ', 'Y': 'Υ'
    }
    for lat, gr in mapping.items():
        norm_text = norm_text.replace(lat, gr)
        
    # Αφαίρεση περιττών κενών
    return " ".join(norm_text.split())

def extract_basic_metadata(doc):
    """Εξάγει βασικά στοιχεία ΦΕΚ και Νόμου από τις 2 πρώτες σελίδες."""
    combined_text = ""
    for i in range(min(2, len(doc))):
        combined_text += doc[i].get_text("text") + "\n"
        
    norm_text = normalize_for_match(combined_text)
    
    # Εντοπισμός Αριθμού Νόμου/ΠΔ
    law_match = re.search(r"(?:ΝΟΜΟΣ|ΠΡΟΕΔΡΙΚΟ\s+ΔΙΑΤΑΓΜΑ|ΑΠΟΦΑΣΗ).*?(?:ΥΠ\s*['’]?\s*ΑΡΙΘΜ\.?|ΑΡΙΘΜ\.)\s*(\d+)", norm_text)
    law_number = law_match.group(1) if law_match else "Unknown"
    
    # Εντοπισμός Τύπου Εγγράφου
    doc_type = "Άγνωστο"
    if "ΝΟΜΟΣ" in norm_text[:1000]: doc_type = "Νόμος"
    elif "ΠΡΟΕΔΡΙΚΟ ΔΙΑΤΑΓΜΑ" in norm_text[:1000]: doc_type = "Προεδρικό Διάταγμα"
    elif "ΠΡΑΞΗ ΥΠΟΥΡΓΙΚΟΥ" in norm_text[:1000]: doc_type = "Π.Υ.Σ."
    elif "ΑΠΟΦΑΣΗ" in norm_text[:1000]: doc_type = "Απόφαση"
    
    # Εντοπισμός ΦΕΚ
    fek_match = re.search(r"ΤΕΥΧΟΣ\s+([Α-Ω]*)[’']?\s*ΑΡ\.?\s*ΦΥΛΛΟΥ\s*(\d+).*?(\d{1,2}\s+[Α-Ω]+\s+\d{4}|\d{2}\.\d{2}\.\d{4})", norm_text)
    if not fek_match:
        # Fallback για εναλλακτική μορφή ημερομηνίας
        fek_match = re.search(r"ΤΕΥΧΟΣ\s+([Α-Ω]*)[’']?\s*(\d+)/(\d{2}\.\d{2}\.\d{4})", norm_text)
        
    if not fek_match:
        series, number, date = "A", "Unknown", "Unknown"
    else:
        series_raw = fek_match.group(1)
        series_map = {"Α": "A", "Β": "B", "Γ": "C", "Δ": "D", "ΠΡΩΤΟ": "A", "ΔΕΥΤΕΡΟ": "B"}
        series = series_map.get(series_raw, series_raw if series_raw else "A")
        number = fek_match.group(2)
        date = fek_match.group(3)
        
    return {
        "law_number": law_number,
        "doc_type": doc_type,
        "fek_series": series,
        "fek_number": number,
        "date": date
    }

def extract_title(doc):
    """Εξάγει τον πλήρη τίτλο χρησιμοποιώντας Regex πάνω στο αρχικό κείμενο."""
    text = doc[0].get_text("text")
    norm_text = normalize_for_match(text)
    clean_text = " ".join(text.split())
    clean_norm = " ".join(norm_text.split())
    
    start_match = re.search(r"(?:ΝΟΜΟΣ|ΔΙΑΤΑΓΜΑ|ΑΠΟΦΑΣΗ)[^0-9]*\d+", clean_norm)
    end_markers = ["Η ΠΡΟΕΔΡΟΣ", "Ο ΠΡΟΕΔΡΟΣ", "Ο ΠΡΩΘΥΠΟΥΡΓΟΣ", "ΕΧΟΝΤΑΣ ΥΠΟΨΗ", "ΑΡΘΡΟ 1"]
    end_pos = len(clean_text)
    
    for marker in end_markers:
        pos = clean_norm.find(marker)
        if pos != -1 and pos < end_pos:
            if pos > (start_match.end() if start_match else 0):
                end_pos = pos
                
    start_pos = start_match.end() if start_match else 0
    title = clean_text[start_pos:end_pos].strip()
    
    if len(title) < 10 or len(title) > 2000:
        return "Δεν εντοπίστηκε τίτλος"
    return title

def scan_document_structure(doc):
    """
    Διαβάζει το PDF ανά 'blocks' για να χαρτογραφήσει τη δομή.
    Χρησιμοποιεί λεξικό για τα άρθρα ώστε το πραγματικό άρθρο στο σώμα του νόμου 
    να 'πατήσει' πάνω στην εγγραφή του Πίνακα Περιεχομένων.
    """
    structure_dict = {}
    ordered_keys = [] # Για να διατηρήσουμε τη σειρά (ΜΕΡΟΣ, ΚΕΦΑΛΑΙΟ, ΑΡΘΡΟ, κλπ)
    
    # Αυστηρά Regex για να μην πιάνουμε κείμενο μέσα στις προτάσεις (π.χ. "μέρος της")
    re_part = re.compile(r"^ΜΕΡΟΣ\s+([Α-ΩIVX]+|\d+)['’]?", re.IGNORECASE)
    re_chapter = re.compile(r"^ΚΕΦΑΛΑΙΟ\s+([Α-ΩIVX]+|\d+)['’]?", re.IGNORECASE)
    re_article = re.compile(r"^(?:Ά|Α)ΡΘΡΟ\s+(\d+[Α-Ω]*|ΠΡΩΤΟ|ΔΕΥΤΕΡΟ|ΤΡΙΤΟ|ΤΕΤΑΡΤΟ)", re.IGNORECASE)
    re_annex = re.compile(r"^ΠΑΡΑΡΤΗΜΑ", re.IGNORECASE)

    for page_num in range(len(doc)):
        page = doc[page_num]
        blocks = page.get_text("blocks")
        
        for block in blocks:
            text = block[4].strip()
            if not text: continue
            
            norm_text = normalize_for_match(text)
            lines = text.split('\n')
            first_line_norm = normalize_for_match(lines[0])
            
            # --- Εντοπισμός Μέρους ---
            m_part = re_part.match(first_line_norm)
            if m_part:
                part_id = m_part.group(1)
                title = lines[1].strip() if len(lines) > 1 else ""
                key = f"PART_{part_id}"
                
                if key not in structure_dict: ordered_keys.append(key)
                structure_dict[key] = {"type": "ΜΕΡΟΣ", "id": part_id, "title": title, "page": page_num + 1}
                continue
                
            # --- Εντοπισμός Κεφαλαίου ---
            m_chap = re_chapter.match(first_line_norm)
            if m_chap:
                chap_id = m_chap.group(1)
                title = lines[1].strip() if len(lines) > 1 else ""
                key = f"CHAPTER_{chap_id}"
                
                if key not in structure_dict: ordered_keys.append(key)
                structure_dict[key] = {"type": "ΚΕΦΑΛΑΙΟ", "id": chap_id, "title": title, "page": page_num + 1}
                continue
                
            # --- Εντοπισμός Άρθρου ---
            m_art = re_article.match(first_line_norm)
            if m_art:
                art_id = m_art.group(1)
                
                # Προσπάθεια εξαγωγής τίτλου (είτε είναι δίπλα στο 'Άρθρο Χ' είτε στην από κάτω γραμμή)
                title = ""
                raw_first_line = lines[0].strip()
                # Αν ο τίτλος είναι στην ίδια γραμμή: π.χ. "Άρθρο 1 Σκοπός"
                title_inline = re.sub(r"^(?:Ά|Α)ΡΘΡΟ\s+" + art_id + r"\s*", "", raw_first_line, flags=re.IGNORECASE)
                if title_inline:
                    title = title_inline
                elif len(lines) > 1:
                    title = lines[1].strip()
                
                # Αφαίρεση τελειών και αριθμών σελίδων που έρχονται από το TOC
                title = re.sub(r"\.*?\s*\d+$", "", title).strip()

                key = f"ARTICLE_{art_id}"
                
                # ΤΟ ΜΥΣΤΙΚΟ ΕΙΝΑΙ ΕΔΩ: Αν το άρθρο υπάρχει ήδη (πχ. από το TOC), 
                # αυτή η γραμμή θα κάνει OVERWRITE τη σελίδα με την πραγματική σελίδα στο σώμα του νόμου!
                if key not in structure_dict: 
                    ordered_keys.append(key)
                
                # Κάνουμε update (ώστε η σελίδα να πάρει την τελευταία τιμή που εντοπίστηκε)
                structure_dict[key] = {"type": "ΑΡΘΡΟ", "id": art_id, "title": title, "page": page_num + 1}
                continue
            
            # --- Εντοπισμός Παραρτήματος ---
            if re_annex.match(first_line_norm):
                key = f"ANNEX_{page_num}" # Μπορεί να έχει πολλά
                if key not in structure_dict: ordered_keys.append(key)
                structure_dict[key] = {"type": "ΠΑΡΑΡΤΗΜΑ", "id": "", "title": "", "page": page_num + 1}

    # Δημιουργία της τελικής δομής με βάση τη σειρά που εντοπίστηκαν
    final_structure = [structure_dict[k] for k in ordered_keys]
    return final_structure

def calculate_ranges(structure, total_pages):
    """Υπολογίζει τις σελίδες (start-end) με βάση το επόμενο δομικό στοιχείο."""
    for i in range(len(structure)):
        start_page = structure[i]["page"]
        
        # Το άρθρο/κεφάλαιο τελειώνει εκεί που ξεκινάει το ΕΠΟΜΕΝΟ στοιχείο
        if i + 1 < len(structure):
            next_page = structure[i+1]["page"]
            end_page = next_page
        else:
            end_page = total_pages
            
        # Αν ξεκινάει και τελειώνει στην ίδια σελίδα
        if start_page == end_page:
            structure[i]["range"] = f"{start_page}"
        else:
            structure[i]["range"] = f"{start_page}-{end_page}"
            
    return structure

def build_index(pdf_path: Path):
    print(f"Indexing: {pdf_path.name}")
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"Error opening {pdf_path}: {e}")
        return
        
    # Ελεγχος για OCR
    total_text_len = sum(len(p.get_text()) for p in doc[:5])
    if total_text_len < settings.min_text_chars:
        print(f"Running OCR on {pdf_path.name}...")
        doc.close()
        ocr_pdf_path = ensure_ocr(pdf_path)
        doc = fitz.open(ocr_pdf_path)

    # Εξαγωγή Μεταδεδομένων
    meta = extract_basic_metadata(doc)
    title = extract_title(doc)
    
    # Χαρτογράφηση Εγγράφου
    raw_structure = scan_document_structure(doc)
    structure = calculate_ranges(raw_structure, len(doc))
        
    # Σώσιμο
    year = meta["date"].split(".")[-1] if "." in meta["date"] else "Unknown"
    output_dir = settings.index_dir / year / f"series_{meta['fek_series']}"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    md_path = output_dir / f"{pdf_path.stem}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("---\n")
        f.write(f"document_id: {pdf_path.stem}\n")
        f.write(f"title: \"{title}\"\n")
        f.write(f"doc_type: {meta['doc_type']}\n")
        f.write(f"law_number: {meta['law_number']}\n")
        f.write(f"fek: {meta['fek_series']} {meta['fek_number']}/{year}\n")
        f.write(f"publication_date: {meta['date']}\n")
        try: 
            rel_pdf = pdf_path.relative_to(Path.cwd())
        except: 
            rel_pdf = pdf_path
        f.write(f"source_pdf: {rel_pdf}\n")
        f.write(f"total_pages: {len(doc)}\n")
        f.write("---\n\n")
        
        f.write(f"# {meta['doc_type']} {meta['law_number']}\n\n")
        f.write(f"{title}\n\n")
        f.write("## Χάρτης Πλοήγησης (Navigation Map)\n\n")
        
        for item in structure:
            if item["type"] == "ΜΕΡΟΣ":
                f.write(f"### ΜΕΡΟΣ {item['id']}: {item['title']}\n\n")
            elif item["type"] == "ΚΕΦΑΛΑΙΟ":
                f.write(f"#### ΚΕΦΑΛΑΙΟ {item['id']}: {item['title']}\n\n")
            elif item["type"] == "ΠΑΡΑΡΤΗΜΑ":
                f.write(f"### ΠΑΡΑΡΤΗΜΑ\n\n")
            elif item["type"] == "ΑΡΘΡΟ":
                title_str = f" ({item['title']})" if item['title'] else ""
                f.write(f"- **Άρθρο {item['id']}**{title_str}: Σελίδες {item['range']}\n")
                
    print(f"Saved: {md_path}")
    doc.close()

def process_all():
    pdf_files = list(settings.raw_dir.glob("**/*.pdf"))
    for pdf_path in pdf_files:
        build_index(pdf_path)

if __name__ == "__main__":
    process_all()
