import base64
import json
import os
import re
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, TypedDict

from langchain_core.documents import Document
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from rich.console import Console

from src.config import settings
from src.pdf.vision_reader import pdf_page_to_base64
from src.rag.agents.base_agent import BaseAgent

_console = Console()

class QueryIntent(TypedDict, total=False):
    law_number: int | None
    fek_series: str | None
    fek_number: int | None
    fek_year: int | None
    article_number: str | None
    keywords: list[str]

_INTENT_SYSTEM = (
    "You are a helpful assistant that extracts structured filters from a Greek legal query. "
    "Respond ONLY with a valid JSON object. Do not include any markdown formatting or extra text."
)

_INTENT_USER_TEMPLATE = """Today is {today}. Analyze the Greek legal query:
"{query}"

Extract the following filters into a JSON object:
{{
  "law_number": integer or null (e.g. from "Ν. 5263" extract 5263),
  "fek_series": "Α" | "Β" | "Γ" | null (e.g. from "ΦΕΚ Α" extract "Α"),
  "fek_number": integer or null (e.g. from "ΦΕΚ 238" extract 238),
  "fek_year": integer or null (e.g. from "2025" as part of FEK reference extract 2025),
  "article_number": string or null (e.g. from "Άρθρο 1" -> "1", "Άρθρο 121" -> "121", "Άρθρο Πρώτο" -> "ΠΡΩΤΟ", "Άρθρο 1Α" -> "1Α"),
  "keywords": list of keywords for text matching (exclude stopwords)
}}
"""

_VISION_SYSTEM_PROMPT = (
    "Είσαι ένας εξειδικευμένος νομικός βοηθός για την Ελληνική Νομοθεσία. "
    "Σου παρέχεται μια εικόνα (σχηματισμένη από σελίδα PDF) ενός επίσημου Φύλλου Εφημερίδας της Κυβερνήσεως (ΦΕΚ). "
    "Απάντησε στην ερώτηση του χρήστη με βάση ΜΟΝΟ την πληροφορία που βλέπεις στην εικόνα. "
    "Διατήρησε τη νομική ορολογία και δομή των άρθρων. Αν η εικόνα δεν περιέχει την απάντηση, ανέφερέ το ρητά."
)

def _normalize(s: str) -> str:
    # Απλή κανονικοποίηση
    s = s.upper()
    accents = {
        'Ά': 'Α', 'Έ': 'Ε', 'Ή': 'Η', 'Ί': 'Ι', 'Ό': 'Ο', 'Ύ': 'Υ', 'Ώ': 'Ω',
        'Ϊ': 'Ι', 'Ϋ': 'Υ', 'ά': 'Α', 'έ': 'Ε', 'ή': 'Η', 'ί': 'Ι', 'ό': 'Ο',
        'ύ': 'Υ', 'ώ': 'Ω', 'ϊ': 'Ι', 'ϋ': 'Υ'
    }
    for acc, no_acc in accents.items():
        s = s.replace(acc, no_acc)
    mapping = {
        'A': 'Α', 'B': 'Β', 'E': 'Ε', 'Z': 'Ζ', 'H': 'Η', 'I': 'Ι',
        'K': 'Κ', 'M': 'Μ', 'N': 'Ν', 'O': 'Ο', 'P': 'Ρ', 'T': 'Τ',
        'X': 'Χ', 'Y': 'Υ'
    }
    for lat, gr in mapping.items():
        s = s.replace(lat, gr)
    return s.strip()

class VisionReaderAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("VisionReaderAgent")
        # Χρησιμοποιούμε το μοντέλο που έχει οριστεί στα settings για chat/vision (συνήθως gpt-4o ή gemini)
        self.llm = ChatOpenAI(
            model=settings.openai_chat_model,
            temperature=0.0,
            api_key=settings.openai_api_key,
            base_url=settings.openai_api_base,
        )
        self.intent_llm = ChatOpenAI(
            model=settings.rewriter_llm_model,
            temperature=0.0,
            model_kwargs={"response_format": {"type": "json_object"}},
            api_key=settings.openai_api_key,
            base_url=settings.openai_api_base,
        )

    def _extract_intent(self, query: str) -> QueryIntent:
        today = date.today().isoformat()
        try:
            resp = self.intent_llm.invoke([
                SystemMessage(content=_INTENT_SYSTEM),
                HumanMessage(content=_INTENT_USER_TEMPLATE.format(today=today, query=query))
            ])
            raw = resp.content or "{}"
            data = json.loads(raw)
            return data
        except Exception as e:
            _console.print(f"[yellow]VisionReaderAgent intent extraction failed:[/yellow] {e}")
            return {}

    def _find_candidate_pdf(self, intent: QueryIntent) -> dict[str, Any] | None:
        # Αναζήτηση στα listing files
        from src.rag.agents.listing_agent import _load_listings
        listings = _load_listings()
        if not listings:
            return None

        best_row = None
        # Φιλτράρισμα με βάση το Intent
        for row in listings:
            # 1. Έλεγχος Αριθμού Νόμου
            if intent.get("law_number") is not None:
                if row.get("number") == intent["law_number"]:
                    return row  # Άμεση επιστροφή αν ταιριάζει ο νόμος
            
            # 2. Έλεγχος ΦΕΚ (Σειρά και Αριθμός)
            if intent.get("fek_number") is not None:
                if row.get("fek_number") == intent["fek_number"]:
                    # Έλεγχος σειράς
                    if intent.get("fek_series"):
                        row_series = _normalize(row.get("fek_series") or "")
                        intent_series = _normalize(intent["fek_series"])
                        if row_series == intent_series:
                            best_row = row
                    else:
                        best_row = row

        return best_row or (listings[0] if listings else None)

    def _get_page_from_index(self, pdf_basename_stem: str, year: int, article_number: str) -> int:
        index_path = Path("corpus") / str(year) / f"{pdf_basename_stem}.md"
        if not index_path.exists():
            return 1
        
        try:
            content = index_path.read_text(encoding="utf-8")
            # Ψάχνουμε για "- **Άρθρο {article_number}**: Σελίδα {page}"
            # Κανονικοποιούμε το article_number για σίγουρη εύρεση
            norm_art = _normalize(article_number)
            
            # Regex που ανιχνεύει το άρθρο
            pattern = rf"-\s+\*\*Άρθρο\s+{re.escape(norm_art)}\*\*:\s+Σελίδα\s+(\d+)"
            match = re.search(pattern, _normalize(content))
            if match:
                return int(match.group(1))
        except Exception as e:
            _console.print(f"[yellow]Error reading index {index_path}:[/yellow] {e}")
            
        return 1

    def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        query = state.get("rewritten_query") or state["query"]
        
        # 1. Εξαγωγή Intent
        intent = self._extract_intent(query)
        _console.print(f"[blue]VisionReaderAgent Intent Extracted:[/blue] {intent}")
        
        # 2. Εντοπισμός PDF
        candidate = self._find_candidate_pdf(intent)
        if not candidate:
            answer = "Δεν βρέθηκε κάποιο σχετικό ΦΕΚ/Έγγραφο στον τοπικό φάκελο downloads."
            return {
                "answer": answer,
                "sources": [],
                "messages": [AIMessage(content=answer)]
            }
            
        pdf_basename = candidate["pdf_basename"]
        pdf_stem = Path(pdf_basename).stem
        year = candidate["fek_date"].year if candidate.get("fek_date") else 2025
        pdf_path = Path("downloads") / str(year) / pdf_basename
        
        # 3. Εύρεση Σελίδας μέσω του Markdown Index
        target_page = 1
        art_num = intent.get("article_number")
        if art_num:
            target_page = self._get_page_from_index(pdf_stem, year, art_num)
            _console.print(f"[blue]VisionReaderAgent mapped Article {art_num} to Page {target_page}[/blue]")
        else:
            _console.print(f"[blue]VisionReaderAgent: No article specified. Defaulting to Page 1[/blue]")

        # 4. Μετατροπή σελίδας σε Image (base64)
        try:
            base64_image = pdf_page_to_base64(pdf_path, target_page)
        except Exception as e:
            answer = f"Σφάλμα κατά την οπτική ανάγνωση της σελίδας {target_page} του PDF: {e}"
            return {
                "answer": answer,
                "sources": [],
                "messages": [AIMessage(content=answer)]
            }

        # 5. Κλήση Multimodal LLM
        user_msg_text = f"Ερώτηση χρήστη: {query}\n\nΑνάλυσε τη σελίδα {target_page} του ΦΕΚ {candidate.get('fek_title_raw', pdf_basename)} και απάντησε με ακρίβεια."
        
        messages = [
            SystemMessage(content=_VISION_SYSTEM_PROMPT),
            HumanMessage(content=[
                {"type": "text", "text": user_msg_text},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{base64_image}"}
                }
            ])
        ]
        
        _console.print(f"[yellow]VisionReaderAgent: Sending page {target_page} image to Multimodal LLM...[/yellow]")
        try:
            response = self.llm.invoke(messages)
            answer_text = response.content or ""
        except Exception as e:
            _console.print(f"[red]Multimodal LLM invocation failed:[/red] {e}")
            answer_text = f"Σφάλμα κατά την επικοινωνία με το μοντέλο Vision: {e}"

        # 6. Δημιουργία Document για την πηγή (Source Citation)
        source_doc = Document(
            page_content=f"Σελίδα {target_page} του ΦΕΚ {candidate.get('fek_title_raw', pdf_basename)}",
            metadata={
                "source": pdf_basename,
                "page": target_page,
                "title": candidate.get("description"),
                "fek_title": candidate.get("fek_title_raw"),
                "fek_date": candidate["fek_date"].isoformat() if candidate.get("fek_date") else None
            }
        )

        return {
            "answer": answer_text,
            "sources": [source_doc],
            "messages": [AIMessage(content=answer_text)]
        }

@lru_cache(maxsize=1)
def get_vision_reader_agent() -> VisionReaderAgent:
    return VisionReaderAgent()
