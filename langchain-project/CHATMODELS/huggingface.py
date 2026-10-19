
from dotenv import load_dotenv
from langchain_huggingface import ChatHuggingFace, HuggingFaceEndpoint
import os
from getpass import getpass

# Load .env from the project root
load_dotenv(
    "/Users/jiteshtomar/Documents/Genrative AI/langchain-project/.env",
    override=True
)

# Read token
token = os.getenv("HUGGINGFACEHUB_API_TOKEN")

if not token or not token.startswith("hf_"):
    token = getpass("Enter your valid Hugging Face token: ")

# Use the same verified token explicitly
llm = HuggingFaceEndpoint(
    repo_id="deepseek-ai/DeepSeek-R1",
    huggingfacehub_api_token=token,
    provider="auto",
    max_new_tokens=256,
)

model = ChatHuggingFace(llm=llm)

response = model.invoke("Who are you?")
print(response.content)
