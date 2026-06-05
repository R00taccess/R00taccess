from fastapi import FastAPI

app = FastAPI(title="RideSignal API")

@app.get("/health")
def health_check():
    return {"status": "ok"}
