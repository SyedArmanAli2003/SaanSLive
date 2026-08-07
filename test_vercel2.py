import requests

url = "https://saanslive.vercel.app/api/chat"
payload = {
    "messages": [{"role": "user", "content": "What is the AQI in Delhi?"}],
    "model": "openai/gpt-oss-20b"
}
try:
    response = requests.post(url, json=payload, timeout=20)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")
