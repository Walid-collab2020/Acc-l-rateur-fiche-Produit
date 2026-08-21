@echo off
cd /d "C:\Users\walid.ben.lamine\OneDrive - Accenture\01ApplicactionCartoProduit"
py -m uvicorn app.main:app --reload --port 8000 --app-dir backend

