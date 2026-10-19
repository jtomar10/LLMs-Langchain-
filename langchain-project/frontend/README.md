# MR. JITESH AI AGENT — Frontend

A light-theme chat interface for the existing FastAPI backend. Plain HTML, CSS and JavaScript. No build step, no npm, no framework.

The frontend only talks to your backend at `http://127.0.0.1:8000`. The Groq API key stays in the backend's `.env` file and never reaches the browser.

## 1. Where the files go

Create the `frontend` folder inside your existing project. Do not move or edit any Python file.

```text
/Users/jiteshtomar/Documents/Genrative AI/langchain-project/
├── .venv/
├── CHATMODELS/
├── EMBEDDINGS_MODELS/
├── .env
├── .gitignore
├── backend.py
└── frontend/
    ├── index.html
    ├── css/
    │   └── styles.css
    ├── js/
    │   └── app.js
    └── README.md
```

## 2. One-time VS Code setup (macOS)

1. Open the project folder in VS Code: **File → Open Folder…** and choose `langchain-project`. Open the folder itself, not a parent folder, so the Live Server URL stays short.
2. Install two extensions (**Cmd + Shift + X**):
   - **Python** (publisher: Microsoft, id `ms-python.python`)
   - **Live Server** (publisher: Ritwick Dey, id `ritwickdey.LiveServer`)
3. Select your virtual environment: press **Cmd + Shift + P**, run **Python: Select Interpreter**, and choose the entry that points to `./.venv/bin/python`.

## 3. Run it (every time)

**Backend**

1. Open `backend.py` in the editor.
2. Click the **Run Python File** button (the ▶ at the top right of the editor).
3. Wait for the terminal to show `Uvicorn running on http://127.0.0.1:8000`.

**Frontend**

1. Open `frontend/index.html`.
2. Right-click inside the file and choose **Open with Live Server**, or click **Go Live** in the bottom-right status bar.
3. The browser opens `http://127.0.0.1:5500/frontend/index.html`.

The status pill in the header should change from *Connecting* to *Connected*. If it shows *Disconnected*, the backend is not running. The frontend never starts the backend for you.

Stop the backend with the trash-can icon in the VS Code terminal panel, or press **Ctrl + C** in that terminal.

## 4. Why Live Server is preferred over double-clicking `index.html`

Opening the file directly (`file:///…/index.html`) can work, but the browser sends the origin `null` with every request. The backend's CORS list currently allows only `localhost` and `127.0.0.1` on ports 5500 and 8000, so a `file://` page is blocked and the status stays *Disconnected*.

Two fixes, pick one:

- **Recommended:** use Live Server (section 3). No backend change needed.
- Or add `"null"` to `allow_origins` in `backend.py` for local development only. Remove it before any deployment.

If Live Server picks another port (for example 5501 when 5500 is busy), the backend will block it too. See the optional CORS change in section 7.

## 5. How it behaves

| Area | Behaviour |
| --- | --- |
| Modes | `regular`, `funny`, `fluent`. The selected value is sent with every `/chat` request. |
| Sessions | The `session_id` returned by the backend is saved per conversation and reused. A new chat starts with `session_id: null`. |
| Mode switch | The backend rebuilds history when the mode differs from the session's mode. The UI warns before you send, and adds a divider in the thread afterwards. |
| Storage | Conversations and messages are kept in `localStorage` under `mja.frontend.v1`. No keys or secrets are stored. |
| Restored history | Saved messages are restored after a refresh. **The model's memory is not**: it lives in backend RAM and is lost when the backend restarts. |
| Markdown | Replies are rendered with a small built-in renderer that creates DOM nodes only. Nothing from the API is inserted as HTML. |
| Errors | `422`, `429`, `502`, timeouts and network failures each show a clear message with a Retry button. |

## 6. Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Status stays *Disconnected* | Backend not running. Run `backend.py` and select the status pill to check again. |
| Disconnected, but the backend is running | CORS. Check the address bar. It must be `http://127.0.0.1:5500` or `http://localhost:5500`, not `file://` and not another port. |
| `GET http://127.0.0.1:8000/health` works in the browser tab but not in the app | Same CORS cause. Compare the page origin with `allow_origins` in `backend.py`. |
| Error 429 | Groq rate limit. Wait and press Retry. |
| Error 502 | Groq or the model failed. Check the backend terminal and your `GROQ_API_KEY`. |
| "Empty reply" error | The model used its whole `max_tokens` budget. See section 7. |
| Fonts look different | Fonts load from Google Fonts. Offline, the system serif and sans-serif fonts are used instead. |

## 7. Optional backend improvements

The frontend works with `backend.py` exactly as it is. These small changes improve integration. None changes the API contract.

**a) Detect expired sessions (recommended).** The backend silently starts a fresh history when it receives an unknown `session_id`, so after a restart the frontend cannot tell. Add a per-process boot id to `/health`:

```python
BOOT_ID = str(uuid.uuid4())

@app.get("/health")
def health():
    return {"status": "healthy", "boot_id": BOOT_ID}
```

When the frontend sees a different `boot_id` than the one a conversation was last answered under, it shows a banner: start a new chat, or continue without memory. Without this change the banner never appears.

**b) Accept any local port for Live Server.** Replace `allow_origins=[...]` with:

```python
allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
```

**c) Map Groq errors correctly.** `langchain_groq` uses the `groq` SDK, which raises `groq.RateLimitError` and similar, not `httpx.HTTPStatusError`. As written, a rate limit probably reaches the frontend as a generic `502`. To get a real `429`:

```python
import groq

# inside chat(), before the existing `except httpx.HTTPStatusError`:
except groq.RateLimitError as exc:
    history.pop()
    raise HTTPException(
        status_code=429,
        detail="Groq rate limit reached. Wait or check your account limits.",
    ) from exc
```

**d) Raise `max_tokens`.** `openai/gpt-oss-20b` is a reasoning model. With `max_tokens=512`, long answers can be cut off or come back empty. Try `1024` to `2048`.

## 8. Verification checklist

Run through this once after setup.

- [ ] Backend terminal shows `Uvicorn running on http://127.0.0.1:8000`.
- [ ] Header pill reads *Connected*. Stop the backend and it turns to *Disconnected* within about 15 seconds, or immediately when you select it.
- [ ] Click an example prompt. A real reply arrives, and the typing indicator shows while waiting.
- [ ] In the browser DevTools Network tab, the `/chat` request body contains `message`, `mode` and `session_id`. The first request has `session_id: null`, the next ones reuse the returned id.
- [ ] Switch to **Funny**, then **Fluent**. The request body shows `"mode": "funny"`, then `"mode": "fluent"`. A notice about the memory reset appears before you send.
- [ ] Click **New chat**. The next request again starts with `session_id: null`.
- [ ] Create two conversations and switch between them in the sidebar.
- [ ] Refresh the page. Conversations and messages are still there.
- [ ] **Clear current conversation** asks for confirmation.
- [ ] The copy button on a reply shows *Copied*.
- [ ] Stop the backend and send a message. A clear error with a Retry button appears. Start the backend, press Retry, and the reply arrives without a duplicated user message.
- [ ] Narrow the window below 820 px. The sidebar becomes a drawer opened from the menu button, with no horizontal scrolling.
- [ ] Search the page source and DevTools → Application → Local Storage for `gsk_` or `GROQ`. Nothing is found.
