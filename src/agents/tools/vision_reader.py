import base64
import os
import fitz
from pathlib import Path

def pdf_page_to_png(pdf_path: Path, page_number: int, output_dir: Path = Path("temp_images"), dpi: int = 150) -> Path:
    """Μετατρέπει μια σελίδα PDF σε PNG αρχείο και επιστρέφει το path."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Το PyMuPDF (fitz) είναι 0-indexed, ο χρήστης δίνει 1-indexed
    fitz_page_num = page_number - 1
    
    try:
        doc = fitz.open(pdf_path)
        if fitz_page_num < 0 or fitz_page_num >= len(doc):
            raise IndexError(f"Page number {page_number} out of bounds (1-{len(doc)}).")
            
        page = doc[fitz_page_num]
        
        # 150 DPI είναι ιδανικό για ανάγνωση κειμένου χωρίς τεράστιο μέγεθος αρχείου
        pix = page.get_pixmap(dpi=dpi)
        
        output_file = output_dir / f"{pdf_path.stem}_page_{page_number}.png"
        pix.save(str(output_file))
        return output_file
    except Exception as e:
        print(f"Error converting PDF page to PNG: {e}")
        raise

def pdf_page_to_base64(pdf_path: Path, page_number: int, dpi: int = 150) -> str:
    """Μετατρέπει μια σελίδα PDF σε PNG bytes κωδικοποιημένα σε base64 για το GPT-4o."""
    fitz_page_num = page_number - 1
    
    try:
        doc = fitz.open(pdf_path)
        if fitz_page_num < 0 or fitz_page_num >= len(doc):
            raise IndexError(f"Page number {page_number} out of bounds (1-{len(doc)}).")
            
        page = doc[fitz_page_num]
        pix = page.get_pixmap(dpi=dpi)
        img_bytes = pix.tobytes("png")
        
        return base64.b64encode(img_bytes).decode("utf-8")
    except Exception as e:
        print(f"Error converting PDF page to base64: {e}")
        raise
