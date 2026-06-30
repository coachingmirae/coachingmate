# -*- coding: utf-8 -*-
"""
check_supabase_data.py

실행:
cd D:\coachingmate_mvp
python scripts\check_supabase_data.py
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client


BASE_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BASE_DIR / ".env"

load_dotenv(ENV_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()


def main():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 .env에 없습니다.")

    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    response = (
        supabase
        .table("submissions")
        .select("submitted_at, participant_code, basic_info, leadership_answers, needs_answers")
        .order("submitted_at", desc=True)
        .limit(10)
        .execute()
    )

    rows = response.data or []

    print("=" * 70)
    print("최근 제출 데이터")
    print("=" * 70)

    if not rows:
        print("제출 데이터 없음")
        return

    for idx, row in enumerate(rows, start=1):
        basic_info = row.get("basic_info") or {}

        print(f"[{idx}]")
        print(f"  submitted_at     : {row.get('submitted_at')}")
        print(f"  participant_code : {row.get('participant_code')}")
        print(f"  name             : {basic_info.get('name')}")
        print(f"  company          : {basic_info.get('company')}")
        print(f"  leadership_count : {len(row.get('leadership_answers') or {})}")
        print(f"  needs_count      : {len(row.get('needs_answers') or {})}")
        print("-" * 70)


if __name__ == "__main__":
    main()