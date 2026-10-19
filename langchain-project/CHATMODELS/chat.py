
"""from dotenv import load_dotenv
from langchain.chat_models import init_chat_model

load_dotenv()

model = init_chat_model(
    model="openai/gpt-oss-20b",
    model_provider="groq",
    temperature=0,
)

response = model.invoke(
    "What is the capital of France?"
)

print(response.content)"""


"""import os
from dotenv import load_dotenv
from mistralai.client import Mistral

load_dotenv()

api_key = os.getenv("MISTRAL_API_KEY")

if not api_key:
    raise ValueError(
        "MISTRAL_API_KEY missing. Check your .env file."
    )

client = Mistral(api_key=api_key)

model_name = "voxtral-mini-latest"

try:
    print(f"Testing model: {model_name}")

    response = client.chat.complete(
        model=model_name,
        messages=[
            {
                "role": "user",
                "content": "Explain LangChain in 3 simple points."
            }
        ],
        max_tokens=150,
    )

    print("\nResponse:")
    print(response.choices[0].message.content)

except Exception as error:
    print("\nRequest failed.")
    print(f"Error type: {type(error).__name__}")
    print(f"Details: {error}")
"""



"""import os
from dotenv import load_dotenv
from mistralai.client import Mistral

load_dotenv()

api_key = os.getenv("MISTRAL_API_KEY")
if not api_key:
    raise ValueError("MISTRAL_API_KEY is missing from .env")

client = Mistral(api_key=api_key)

try:
    models = client.models.list()

    print("Models supporting chat completion:\n")

    chat_models = []

    for model in models.data:
        capabilities = getattr(model, "capabilities", None)
        chat_supported = getattr(
            capabilities, "completion_chat", False
        )

        if chat_supported:
            chat_models.append(model.id)
            print(model.id)

    print(f"\nTotal chat-capable models: {len(chat_models)}")

except Exception as error:
    print(f"{type(error).__name__}: {error}")"""



import os
from dotenv import load_dotenv
from mistralai.client import Mistral

load_dotenv()

api_key = os.getenv("MISTRAL_API_KEY")
if not api_key:
    raise ValueError("MISTRAL_API_KEY missing from .env")

client = Mistral(api_key=api_key)

model = "ministral-3b-latest"

try:
    print(f"Testing model: {model}")

    response = client.chat.complete(
        model=model,
        messages=[
            {
                "role": "user",
                "content": "What is LangChain? Explain in 3 short points."
            }
        ],
        max_tokens=100,
    )

    print("\nSuccess! Model response:")
    print(response.choices[0].message.content)

except Exception as error:
    print("\nRequest failed.")
    print(f"Error type: {type(error).__name__}")
    print(f"Details: {error}")

