# -*- coding: utf-8 -*-
"""
sync_supabase_to_google_sheet.py

역할:
1. Supabase submissions 테이블에서 제출 데이터를 조회
2. Google Sheet submissions / leadership_responses / needs_responses 시트에 반영
3. service_account.json 방식 사용

실행:
cd D:\coachingmate_mvp
python scripts\sync_supabase_to_google_sheet.py
"""

import os
import json
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client
import gspread
from google.oauth2.service_account import Credentials


BASE_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BASE_DIR / ".env"

load_dotenv(ENV_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

GOOGLE_SERVICE_ACCOUNT_FILE = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "").strip()
GOOGLE_SHEET_INTERNAL_ID = os.getenv("GOOGLE_SHEET_INTERNAL_ID", "").strip()

SHEET_SUBMISSIONS = "submissions"
SHEET_LEADERSHIP = "leadership_responses"
SHEET_NEEDS = "needs_responses"


def require_env():
    missing = []

    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")

    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")

    if not GOOGLE_SERVICE_ACCOUNT_FILE:
        missing.append("GOOGLE_SERVICE_ACCOUNT_FILE")

    if not GOOGLE_SHEET_INTERNAL_ID:
        missing.append("GOOGLE_SHEET_INTERNAL_ID")

    if missing:
        raise RuntimeError(f".env 설정 누락: {', '.join(missing)}")

    service_account_path = Path(GOOGLE_SERVICE_ACCOUNT_FILE)

    if not service_account_path.exists():
        raise FileNotFoundError(f"service_account.json 파일을 찾을 수 없습니다: {service_account_path}")


def get_supabase_client():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def get_gspread_client():
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]

    credentials = Credentials.from_service_account_file(
        GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes=scopes
    )

    return gspread.authorize(credentials)


def safe_json_dumps(value):
    return json.dumps(value or {}, ensure_ascii=False)


def get_worksheet(spreadsheet, sheet_name):
    try:
        return spreadsheet.worksheet(sheet_name)
    except gspread.WorksheetNotFound:
        raise RuntimeError(f"Google Sheet에 '{sheet_name}' 시트가 없습니다.")


def fetch_submissions(supabase):
    """
    응급 MVP:
    일단 최근 제출 전체를 가져옵니다.
    중복 방지는 Google Sheet submissions의 participant_code + submitted_at 기준으로 처리합니다.
    """
    response = (
        supabase
        .table("submissions")
        .select("*")
        .order("submitted_at", desc=True)
        .limit(200)
        .execute()
    )

    return response.data or []


def get_existing_submission_keys(ws_submissions):
    """
    Google Sheet submissions에서 기존 participant_code + submitted_at 조합을 읽어 중복 append 방지
    """
    rows = ws_submissions.get_all_records()

    existing = set()

    for row in rows:
        submitted_at = str(row.get("submitted_at", "")).strip()
        participant_code = str(row.get("participant_code", "")).strip()

        if submitted_at and participant_code:
            existing.add(f"{participant_code}__{submitted_at}")

    return existing


def append_submission(ws, submission, synced_at):
    basic_info = submission.get("basic_info") or {}
    leadership_answers = submission.get("leadership_answers") or {}
    needs_answers = submission.get("needs_answers") or {}

    row = [
        submission.get("submitted_at", ""),
        submission.get("participant_code", ""),
        basic_info.get("name", ""),
        basic_info.get("company", ""),
        basic_info.get("department", ""),
        basic_info.get("position", ""),
        basic_info.get("email", ""),
        basic_info.get("phone", ""),
        "submitted",
        safe_json_dumps(basic_info),
        safe_json_dumps(leadership_answers),
        safe_json_dumps(needs_answers),
        safe_json_dumps(submission.get("raw_payload") or {}),
        synced_at
    ]

    ws.append_row(row, value_input_option="USER_ENTERED")


def append_leadership_rows(ws, submission, synced_at):
    participant_code = submission.get("participant_code", "")
    submitted_at = submission.get("submitted_at", "")

    leadership_answers = submission.get("leadership_answers") or {}

    rows = []

    for item_code, value in leadership_answers.items():
        rows.append([
            submitted_at,
            participant_code,
            item_code,
            value,
            synced_at
        ])

    if rows:
        ws.append_rows(rows, value_input_option="USER_ENTERED")


def append_needs_rows(ws, submission, synced_at):
    participant_code = submission.get("participant_code", "")
    submitted_at = submission.get("submitted_at", "")

    needs_answers = submission.get("needs_answers") or {}

    rows = []

    for question_code, answer in needs_answers.items():
        rows.append([
            submitted_at,
            participant_code,
            question_code,
            answer,
            synced_at
        ])

    if rows:
        ws.append_rows(rows, value_input_option="USER_ENTERED")


def main():
    print("=" * 70)
    print("CoachingMate Supabase → Google Sheet 동기화")
    print("=" * 70)

    require_env()

    supabase = get_supabase_client()
    gc = get_gspread_client()

    spreadsheet = gc.open_by_key(GOOGLE_SHEET_INTERNAL_ID)

    ws_submissions = get_worksheet(spreadsheet, SHEET_SUBMISSIONS)
    ws_leadership = get_worksheet(spreadsheet, SHEET_LEADERSHIP)
    ws_needs = get_worksheet(spreadsheet, SHEET_NEEDS)

    submissions = fetch_submissions(supabase)
    existing_keys = get_existing_submission_keys(ws_submissions)

    synced_at = datetime.now(timezone.utc).isoformat()

    new_count = 0
    skip_count = 0

    # 오래된 제출부터 append되도록 역순 처리
    for submission in reversed(submissions):
        participant_code = submission.get("participant_code", "")
        submitted_at = submission.get("submitted_at", "")

        key = f"{participant_code}__{submitted_at}"

        if key in existing_keys:
            skip_count += 1
            continue

        append_submission(ws_submissions, submission, synced_at)
        append_leadership_rows(ws_leadership, submission, synced_at)
        append_needs_rows(ws_needs, submission, synced_at)

        existing_keys.add(key)
        new_count += 1

        print(f"[SYNC] {participant_code} / {submitted_at}")

    print("-" * 70)
    print(f"신규 동기화: {new_count}")
    print(f"기존 스킵: {skip_count}")
    print("완료")


if __name__ == "__main__":
    main()