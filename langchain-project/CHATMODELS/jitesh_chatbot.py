




from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.messages import (
    AIMessage,
    SystemMessage,
    HumanMessage,
)
import httpx
import os


load_dotenv()

# Check API key
if not os.getenv("GROQ_API_KEY"):
    raise ValueError(
        "GROQ_API_KEY missing. Check your .env file."
    )

# Initialize model
model = ChatGroq(
    model="openai/gpt-oss-20b",
    temperature=0.9,
    max_tokens=512
)

# Select AI mode
print("Choose your AI mode")
print("1. Regular mode")
print("2. Funny mode")
print("3. Fluent mode")

try:
    choice = int(input("Enter your choice: "))
except ValueError:
    print("Invalid input. Enter 1, 2, or 3.")
    raise SystemExit(1)


BOT_IDENTITY = """
Your name is MR. JITESH AI AGENT.
You were created by Jitesh.

Whenever someone asks your name, introduce yourself as
MR. JITESH AI AGENT.

Never identify yourself as ChatGPT, Gemini, or another
assistant. You are MR. JITESH AI AGENT, an AI assistant
powered by a language model.

Maintain this identity throughout the conversation.
"""

modes = {
    1: BOT_IDENTITY + """
    You are in Regular Mode.
    Respond clearly, accurately, and concisely.
    """,

    2: BOT_IDENTITY + """
    You are in Funny Mode.
    Use appropriate humor, jokes, and playful responses
    while remaining helpful.
    """,

    3: BOT_IDENTITY + """
    You are in Fluent Mode.
    Respond naturally, smoothly, and articulately.
    """
}


if choice not in modes:
    print("Invalid choice. Please select 1, 2, or 3.")
    raise SystemExit(1)

messages = [
    SystemMessage(content=modes[choice])
]

print(
    "\nWelcome to Jitesh's Chatbot! "
    "Type 0 to exit the application."
)

while True:
    prompt = input("\nYou: ").strip()

    # Exit before adding anything to conversation history
    if prompt == "0":
        print("Chatbot closed. Goodbye!")
        break

    if not prompt:
        continue

    messages.append(HumanMessage(content=prompt))

    try:
        response = model.invoke(messages)

        messages.append(AIMessage(content=response.content))
        print("Bot:", response.content)

    except httpx.HTTPStatusError as e:
        # Remove the unanswered user message from history
        messages.pop()

        status = e.response.status_code

        if status == 429:
            print(
                "Rate limit exceeded. Please wait before "
                "trying again, or check your Mistral usage "
                "and account limits."
            )

        elif status == 401:
            print(
                "Authentication failed. Check your "
                "MISTRAL_API_KEY."
            )

        elif status == 402:
            print(
                "Payment or account quota issue. "
                "Check your Mistral account."
            )

        else:
            print(f"API error: HTTP {status}")
            print(e.response.text[:500])

    except Exception as e:
        messages.pop()
        print(f"Unexpected error: {type(e).__name__}: {e}")

print("\nChat session ended.")