import fitz
import re
from pathlib import Path

def normalize_text(text):
    norm_text = text.upper()
    accents = {
        'Ά': 'Α', 'Έ': 'Ε', 'Ή': 'Η', 'Ί': 'Ι', 'Ό': 'Ο', 'Ύ': 'Υ', 'Ώ': 'Ω',
        'Ϊ': 'Ι', 'Ϋ': 'Υ', 'ΐ': 'Ι', 'ΰ': 'Υ', 'ά': 'Α', 'έ': 'Ε', 'ή': 'Η',
        'ί': 'Ι', 'ό': 'Ο', 'ύ': 'Υ', 'ώ': 'Ω', 'ϊ': 'Ι', 'ϋ': 'Υ'
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
    return norm_text

def build_index_fixed(pdf_path):
    doc = fitz.open(pdf_path)
    index_entries = []
    
    # 1. Identify Table of Contents (ToC) pages
    toc_pages = set()
    for page_num in range(min(5, len(doc))):
        text = doc[page_num].get_text("text")
        norm_text = normalize_text(text)
        
        # Heuristic A: Word "ΠΕΡΙΕΧΟΜΕΝΑ" or "ΠΙΝΑΚΑΣ ΠΕΡΙΕΧΟΜΕΝΩΝ"
        has_toc_keyword = "ΠΕΡΙΕΧΟΜΕΝΑ" in norm_text or "ΠΙΝΑΚΑΣ" in norm_text
        
        # Heuristic B: High density of articles
        matches = list(re.finditer(r"(?:^|\n)[\s]*ΑΡΘΡΟ\s+([0-9]+[Α-Ω]*|[Α-Ω]+)", norm_text))
        
        if has_toc_keyword or len(matches) >= 4:
            print(f"Page {page_num + 1} identified as Table of Contents (Keyword: {has_toc_keyword}, Matches: {len(matches)})")
            toc_pages.add(page_num)
            
    # 2. Extract articles from non-ToC pages
    for page_num in range(len(doc)):
        if page_num in toc_pages:
            continue
            
        text = doc[page_num].get_text("text")
        norm_text = normalize_text(text)
        
        # Match "ΑΡΘΡΟ X"
        matches = re.finditer(r"(?:^|\n)[\s]*ΑΡΘΡΟ\s+([0-9]+[Α-Ω]*|[Α-Ω]+)\b", norm_text)
        for match in matches:
            article_num = match.group(1)
            index_entries.append((article_num, page_num + 1))
            
    # Deduplicate keeping the first occurrence (which is now guaranteed to be the actual starting page)
    seen_articles = set()
    unique_entries = []
    for art, page in index_entries:
        if art not in seen_articles:
            unique_entries.append((art, page))
            seen_articles.add(art)
            
    return unique_entries

pdf_path = Path("downloads/2025/20250100176.pdf")
entries = build_index_fixed(pdf_path)
print("\n--- FIXED INDEX ENTRIES ---")
for art, page in entries[:15]:
    print(f"Άρθρο {art} -> Σελίδα {page}")
