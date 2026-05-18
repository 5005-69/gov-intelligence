import os
import fitz
import re
from pathlib import Path

def normalize_text(text):
    """Μετατρέπει σε κεφαλαία, αφαιρεί τόνους και διορθώνει λατινικούς χαρακτήρες που μοιάζουν με ελληνικούς."""
    # 1. Μετατροπή σε κεφαλαία
    norm_text = text.upper()
    
    # 2. Αφαίρεση ελληνικών τόνων και διαλυτικών
    accents = {
        'Ά': 'Α', 'Έ': 'Ε', 'Ή': 'Η', 'Ί': 'Ι', 'Ό': 'Ο', 'Ύ': 'Υ', 'Ώ': 'Ω',
        'Ϊ': 'Ι', 'Ϋ': 'Υ', 'ΐ': 'Ι', 'ΰ': 'Υ', 'ά': 'Α', 'έ': 'Ε', 'ή': 'Η',
        'ί': 'Ι', 'ό': 'Ο', 'ύ': 'Υ', 'ώ': 'Ω', 'ϊ': 'Ι', 'ϋ': 'Υ'
    }
    for acc, no_acc in accents.items():
        norm_text = norm_text.replace(acc, no_acc)
        
    # 3. Αντικατάσταση Λατινικών χαρακτήρων με Ελληνικούς (όπου μοιάζουν οπτικά)
    mapping = {
        'A': 'Α', 'B': 'Β', 'E': 'Ε', 'Z': 'Ζ', 'H': 'Η', 'I': 'Ι',
        'K': 'Κ', 'M': 'Μ', 'N': 'Ν', 'O': 'Ο', 'P': 'Ρ', 'T': 'Τ',
        'X': 'Χ', 'Y': 'Υ'
    }
    for lat, gr in mapping.items():
        norm_text = norm_text.replace(lat, gr)
        
    return norm_text

def extract_metadata(first_page_text, second_page_text=""):
    combined_text = first_page_text + "\n" + second_page_text
    norm_text = normalize_text(combined_text)
    
    # Αναζήτηση για ΝΟΜΟΣ, ΠΔ, ΠΥΣ κλπ. και τον αριθμό
    law_match = re.search(r"(?:ΝΟΜΟΣ|ΠΡΟΕΔΡΙΚΟ\s+ΔΙΑΤΑΓΜΑ|ΠΡΑΞΗ\s+ΥΠΟΥΡΓΙΚΟΥ\s+ΣΥΜΒΟΥΛΙΟΥ|ΑΠΟΦΑΣΗ)[^\d]*(\d+)", norm_text)
    
    # Αναζήτηση ΦΕΚ (π.χ. ΤΕΥΧΟΣ Α’ 235/17.12.2025)
    fek_match = re.search(r"ΤΕΥΧΟΣ\s+([Α-Ω]*)[’']?\s*(\d+)/(\d{2}\.\d{2}\.\d{4})", norm_text)
    
    if not fek_match:
        # Δοκιμή εναλλακτικών patterns αν αποτύχει το βασικό
        series_match = re.search(r"ΤΕΥΧΟΣ\s+(ΠΡΩΤΟ|ΔΕΥΤΕΡΟ|ΤΡΙΤΟ)", norm_text)
        num_match = re.search(r"ΑΡ\.\s*ΦΥΛΛΟΥ\s*(\d+)", norm_text)
        date_match = re.search(r"(\d{1,2}\s+[Α-Ω]+\s+\d{4})", norm_text)
        
        series = "A" if series_match and series_match.group(1) == "ΠΡΩΤΟ" else "Unknown"
        number = num_match.group(1) if num_match else "Unknown"
        date = date_match.group(1) if date_match else "Unknown"
    else:
        series = fek_match.group(1)
        if not series: series = "A"
        number = fek_match.group(2)
        date = fek_match.group(3)
    
    law_number = law_match.group(1) if law_match else "Unknown"
    return law_number, series, number, date

def build_index(pdf_path, output_dir):
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"Error opening {pdf_path}: {e}")
        return
        
    if len(doc) == 0:
        return
        
    first_page_text = doc[0].get_text("text")
    second_page_text = doc[1].get_text("text") if len(doc) > 1 else ""
    
    law_number, fek_series, fek_number, date = extract_metadata(first_page_text, second_page_text)
    
    index_entries = []
    # Ψάχνουμε για το μοτίβο "Άρθρο X" σε κάθε σελίδα
    for page_num in range(len(doc)):
        text = doc[page_num].get_text("text")
        norm_text = normalize_text(text)
        
        # Κανονική έκφραση για Άρθρα
        # Απαιτούμε το "ΑΡΘΡΟ X" να είναι σε δική του γραμμή για να αποφύγουμε τα Περιεχόμενα (Table of Contents)
        matches = re.finditer(r"(?:^|\n)[\s]*ΑΡΘΡΟ\s+([0-9]+[Α-Ω]*|[Α-Ω]+)[\s]*(?:\n|$)", norm_text)
        for match in matches:
            article_num = match.group(1)
            index_entries.append((article_num, page_num + 1))
            
    # Αφαίρεση διπλότυπων (κρατάμε την πρώτη σελίδα εμφάνισης)
    seen_articles = set()
    unique_entries = []
    for art, page in index_entries:
        if art not in seen_articles:
            unique_entries.append((art, page))
            seen_articles.add(art)
            
    # Εξαγωγή σε Markdown
    pdf_name = pdf_path.stem
    year = pdf_path.parent.name
    md_path = output_dir / f"{pdf_name}.md"
    
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("---\n")
        f.write(f"document_id: {pdf_name}\n")
        f.write(f"law_number: {law_number}\n")
        f.write(f"fek: {fek_series} {fek_number}/{year}\n")
        f.write(f"publication_date: {date}\n")
        f.write(f"source_pdf: {pdf_path.name}\n")
        f.write(f"total_pages: {len(doc)}\n")
        f.write("---\n\n")
        f.write(f"# Ευρετήριο ΦΕΚ {fek_series} {fek_number}\n\n")
        f.write(f"**Αριθμός Νόμου / Πράξης:** {law_number}\n")
        f.write(f"**Ημερομηνία Δημοσίευσης:** {date}\n\n")
        f.write("## Χάρτης Πλοήγησης (Navigation Map)\n\n")
        f.write("> Ο παρακάτω χάρτης χρησιμοποιείται από το Vision-Agentic RAG για να εντοπίζει σε ποια σελίδα βρίσκεται το κάθε Άρθρο.\n\n")
        
        if not unique_entries:
            f.write("Δεν εντοπίστηκαν ξεκάθαρα άρθρα. Πιθανώς πρόκειται για σκαναρισμένο έγγραφο χωρίς OCR ή έγγραφο διαφορετικής δομής.\n")
        else:
            for art, page in unique_entries:
                f.write(f"- **Άρθρο {art}**: Σελίδα {page}\n")
                
def main():
    pdf_dir = Path("downloads/2025")
    output_dir = Path("corpus/2025")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    pdf_files = list(pdf_dir.glob("*.pdf"))
    if not pdf_files:
        print(f"Δεν βρέθηκαν PDF στον φάκελο {pdf_dir}")
        return
        
    for pdf_path in pdf_files:
        build_index(pdf_path, output_dir)
        print(f"Processed {pdf_path.name}")

if __name__ == "__main__":
    main()
