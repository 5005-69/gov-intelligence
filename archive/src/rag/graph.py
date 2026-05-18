import atexit
from typing import Any

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from src.config import settings
from src.rag.agents.rewriter_agent import get_rewriter_agent
from src.rag.agents.vision_reader_agent import get_vision_reader_agent
from src.rag.state import RAGState, create_initial_state


def _build_checkpointer():
    dsn = settings.checkpointer_dsn
    if not dsn:
        return MemorySaver()

    import psycopg
    from langgraph.checkpoint.postgres import PostgresSaver

    db_conn = psycopg.connect(dsn, autocommit=True, prepare_threshold=0)
    atexit.register(db_conn.close)
    cp = PostgresSaver(db_conn)
    cp.setup()
    return cp


_compiled_graph = None


def get_graph():
    global _compiled_graph
    if _compiled_graph is not None:
        return _compiled_graph

    workflow = StateGraph(RAGState)

    # Προσθήκη των νέων AI-native Vision κόμβων
    workflow.add_node("rewriter", get_rewriter_agent().execute)
    workflow.add_node("vision_reader", get_vision_reader_agent().execute)

    workflow.add_edge(START, "rewriter")
    workflow.add_edge("rewriter", "vision_reader")
    workflow.add_edge("vision_reader", END)

    checkpointer = _build_checkpointer()
    _compiled_graph = workflow.compile(checkpointer=checkpointer)
    return _compiled_graph


def run_multi_agent_query(
    query: str,
    session_id: str,
    year: int | None = None,
    top_k: int | None = None,
) -> dict[str, Any]:
    graph = get_graph()
    initial = create_initial_state(query=query, year=year, top_k=top_k)
    initial["messages"] = [HumanMessage(content=query)]

    result = graph.invoke(
        initial,
        config={"configurable": {"thread_id": session_id}},
    )

    return {
        "query": query,
        "rewritten_query": result.get("rewritten_query", query),
        "answer": result.get("answer", ""),
        "sources": result.get("sources", []),
        "chunk_results": [],
        "listing_results": [],
    }
