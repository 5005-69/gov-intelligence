from pathlib import Path

import ocrmypdf

from src.config import settings


def _cache_root() -> Path:
    # Use corpus_dir/.ocr_cache for OCR cached files
    return settings.corpus_dir / ".ocr_cache"


def _cache_path(pdf: Path) -> Path:
    # Generate a relative path for cache based on the raw_dir
    try:
        rel = pdf.resolve().relative_to(settings.raw_dir.resolve())
    except ValueError:
        rel = Path(pdf.name)
    return _cache_root() / rel


def ensure_ocr(pdf: Path) -> Path:
    """
    Checks if an OCR version exists. If not, runs OCR and returns the path to the OCRed PDF.
    """
    out = _cache_path(pdf)
    if out.exists() and out.stat().st_mtime >= pdf.stat().st_mtime:
        return out

    out.parent.mkdir(parents=True, exist_ok=True)
    languages = [
        code.strip() for code in settings.ocr_languages.split("+") if code.strip()
    ]
    
    print(f"Running OCR for {pdf.name}...")
    ocrmypdf.ocr(
        str(pdf),
        str(out),
        language=languages,
        force_ocr=False, # Use False to avoid re-OCR if text already exists but was requested
        skip_text=True,   # Only OCR pages without text
        deskew=True,
        rotate_pages=True,
        optimize=1,
        invalidate_digital_signatures=True,
        progress_bar=False,
    )
    return out
