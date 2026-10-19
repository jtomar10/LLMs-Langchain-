from langchain_huggingface import HuggingFaceEmbeddings

embedding = HuggingFaceEmbeddings(
    model_name = "sentence-transformers/all-MiniLM-L6-v2"

)
texts = [
    "Hello I'm Jitesh Tomar",
    "I'm a young talent and have multilpe skills in Ai and ML",
    "And you all are very beautiful"
]



vector = embedding.embed_documents(texts)

print(vector)