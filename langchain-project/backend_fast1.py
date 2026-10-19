
import os
import uuid

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from langchain_groq import ChatGroq
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
)
from pydantic import BaseModel, Field
import httpx


# Load environment variables from project root
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

if not os.getenv("GROQ_API_KEY"):
    raise RuntimeError(
        "GROQ_API_KEY missing. Check the project-root .env file."
    )


app = FastAPI(
    title="MR. JITESH AI AGENT",
    description="AI chatbot powered by FastAPI, LangChain and Groq.",
    version="1.0.0",
)

# Allow the frontend to connect during development.
# Restrict origins to your actual frontend origin before deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


model = ChatGroq(
    model="openai/gpt-oss-20b",
    temperature=0.9,
    max_tokens=512,
)

BOT_IDENTITY = """
Your name is MR. JITESH AI AGENT.
You were created by Jitesh.
Introduce yourself as MR. JITESH AI AGENT when asked.
Respond helpfully and accurately.
"""

MODES = {
    "regular": (
        BOT_IDENTITY
        + " Respond clearly, accurately, and concisely."
    ),
    "funny": (
        BOT_IDENTITY
        + " Use appropriate humor while remaining helpful."
    ),
    "fluent": (
        BOT_IDENTITY
        + " Respond naturally, smoothly, and articulately."
    ),
}

# In-memory conversation storage for development.
# Sessions reset when the backend process restarts.
sessions = {}


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10000)
    mode: str = "regular"
    session_id: str | None = Field(default=None, max_length=100)


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    mode: str


@app.get("/")
def home():
    return {
        "app": "MR. JITESH AI AGENT",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    message = request.message.strip()
    mode = request.mode.lower().strip()

    if not message:
        raise HTTPException(
            status_code=422,
            detail="Message cannot be empty.",
        )

    if mode not in MODES:
        raise HTTPException(
            status_code=422,
            detail="Mode must be regular, funny, or fluent.",
        )

    session_id = request.session_id or str(uuid.uuid4())

    # Start a session or reset it when the selected mode changes.
    if (
        session_id not in sessions
        or sessions[session_id]["mode"] != mode
    ):
        sessions[session_id] = {
            "mode": mode,
            "messages": [
                SystemMessage(content=MODES[mode])
            ],
        }

    history = sessions[session_id]["messages"]
    history.append(HumanMessage(content=message))

    try:
        result = model.invoke(history)

    except httpx.HTTPStatusError as exc:
        history.pop()
        status = exc.response.status_code

        if status == 429:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Groq rate limit reached. "
                    "Wait or check your account limits."
                ),
            ) from exc

        if status in (401, 403):
            raise HTTPException(
                status_code=502,
                detail=(
                    "Groq authentication or permission error. "
                    "Check your API key and account access."
                ),
            ) from exc

        raise HTTPException(
            status_code=502,
            detail=f"AI provider returned HTTP {status}.",
        ) from exc

    except Exception as exc:
        history.pop()
        raise HTTPException(
            status_code=502,
            detail="The AI service could not complete the request.",
        ) from exc

    history.append(AIMessage(content=result.content))

    return ChatResponse(
        reply=result.content,
        session_id=session_id,
        mode=mode,
    )


if __name__ == "__main__":
    # Clicking VS Code's Run Python File button starts the API.
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        reload=False,
    )
